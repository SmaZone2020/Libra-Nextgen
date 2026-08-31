//

using System;
using System.IO.Pipes;
using System.Management.Automation;
using System.Management.Automation.Runspaces;
using System.Text;

namespace PsInline
{
    public class Stub
    {
        /// Host environment snapshot when config boot fails (for diagnosis).
        private static string HostDiag = null;

        public int Run(string args)
        {
            string pipeName = "";
            string scriptB64 = "";
            int timeoutMs = 60000;
            try
            {
                var parts = args.Split('|');
                if (parts.Length >= 1) pipeName = parts[0];
                if (parts.Length >= 2) scriptB64 = parts[1];
                if (parts.Length >= 3) int.TryParse(parts[2], out timeoutMs);
            }
            catch
            {
            }
            return RunCore(pipeName, scriptB64, timeoutMs);
        }

        private static int RunCore(string pipeName, string scriptB64, int timeoutMs)
        {
            bool dbg = Environment.GetEnvironmentVariable("PS_INLINE_DEBUG") == "1";
            Action<string> trace = (string step) =>
            {
                if (!dbg) return;
                try
                {
                    System.IO.File.AppendAllText(
                        System.IO.Path.Combine(System.IO.Path.GetTempPath(), "ps_inline_dbg.txt"),
                        DateTime.UtcNow.ToString("HH:mm:ss.fff") + " " + step + Environment.NewLine);
                }
                catch {}
            };
            trace("enter");
            try
            {
                // Embedded CLR host has no valid application config path; .NET
                // Framework ClientConfigPaths throws "path contains illegal
                // characters" whenever ServicePointManager bootstraps its
                // diagnostics (TraceSource → DiagnosticsConfiguration →
                // ConfigurationManager → Path.GetFullPath(host exe config)).
                //
                // Primary fix: the documented switch that makes System.Net skip
                // diagnostic tracing entirely (no config dependency at all).
                try
                {
                    System.AppContext.SetSwitch(
                        "Switch.System.Net.DontEnableSystemDiagnosticsTracing", true);
                }
                catch {}

                // Belt & braces: pin a valid config baseline for any code that
                // still reaches ConfigurationManager.
                string cfgPath = null;
                try
                {
                    cfgPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "libra_pwsh_unused.config");
                    if (!System.IO.File.Exists(cfgPath))
                        System.IO.File.WriteAllText(cfgPath, "<?xml version=\"1.0\"?>\r\n<configuration/>\r\n");
                    var appBase = System.IO.Path.GetDirectoryName(cfgPath);
                    var dom = System.AppDomain.CurrentDomain;
                    System.AppDomain.CurrentDomain.SetData("APPBASE", appBase);
                    System.AppDomain.CurrentDomain.SetData("APP_CONFIG_FILE", cfgPath);
                    var storeField = typeof(System.AppDomain).GetField(
                        "_FusionStore",
                        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                    if (storeField != null)
                    {
                        var store = storeField.GetValue(dom);
                        var storeType = store.GetType();
                        var fAppBase = storeType.GetField("_application_base",
                            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                        var fCfg = storeType.GetField("_configuration_file",
                            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                        if (fAppBase != null) fAppBase.SetValue(store, appBase);
                        if (fCfg != null) fCfg.SetValue(store, cfgPath);
                    }
                    // Final fallback: pre-populate the ClientConfigPaths cache.
                    // The config system's constructor fallback (no entry
                    // assembly) builds a path that Path.GetFullPath rejects in
                    // this embedded host; with a valid instance cached, every
                    // later GetPaths() returns it without touching the broken
                    // constructor path.
                    try
                    {
                        var ccpType = typeof(System.Configuration.ConfigurationManager).Assembly
                            .GetType("System.Configuration.ClientConfigPaths");
                        if (ccpType != null)
                        {
                            var ctor = ccpType.GetConstructor(
                                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic,
                                null,
                                new System.Type[] { typeof(string), typeof(bool) },
                                null);
                            var pathsField = ccpType.GetField("s_paths",
                                System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
                            if (ctor != null && pathsField != null)
                            {
                                var inst = ctor.Invoke(new object[] { cfgPath, true });
                                pathsField.SetValue(null, inst);
                                trace("ClientConfigPaths s_paths pre-populated: " + inst);
                            }
                            else
                            {
                                trace("s_paths inject skipped (ctor=" + (ctor != null) + " field=" + (pathsField != null) + ")");
                            }
                        }
                        else
                        {
                            trace("ClientConfigPaths type not found");
                        }
                    }
                    catch (System.Exception e)
                    {
                        trace("s_paths inject failed: " + e);
                    }

                    // Probe: try to boot the config system. NOT fatal — the
                    // DontEnableSystemDiagnosticsTracing switch is what stops
                    // ServicePointManager from needing config at all; the probe
                    // only records the host environment if something else still
                    // reaches ConfigurationManager.
                    try
                    {
                        var probe = System.Configuration.ConfigurationManager.GetSection("appSettings");
                        trace("config boot OK (appSettings=" + (probe == null ? "null" : "non-null") + ")");
                    }
                    catch (System.Exception cfgEx)
                    {
                        trace("config probe failed (non-fatal): " + cfgEx);
                        // Snapshot the host environment so the offending input
                        // (command line / AppBase / config file / entry assembly)
                        // is identifiable if PowerShell still fails later.
                        try
                        {
                            var sb = new System.Text.StringBuilder();
                            sb.Append("cmdline:");
                            try { sb.Append(string.Join("|", Environment.GetCommandLineArgs())); }
                            catch (System.Exception e) { sb.Append("<err:").Append(e.Message).Append('>'); }
                            sb.Append("; AB:");
                            try { sb.Append(System.AppDomain.CurrentDomain.SetupInformation.ApplicationBase); }
                            catch (System.Exception e) { sb.Append("<err:").Append(e.Message).Append('>'); }
                            sb.Append("; CF:");
                            try { sb.Append(System.AppDomain.CurrentDomain.SetupInformation.ConfigurationFile); }
                            catch (System.Exception e) { sb.Append("<err:").Append(e.Message).Append('>'); }
                            sb.Append("; EA:");
                            try
                            {
                                var ea = System.Reflection.Assembly.GetEntryAssembly();
                                sb.Append(ea == null ? "<null>" : ea.Location);
                            }
                            catch (System.Exception e) { sb.Append("<err:").Append(e.Message).Append('>'); }
                            sb.Append("; CLR:");
                            try { sb.Append(Environment.Version.ToString()); }
                            catch {}
                            sb.Append("; FPathCandidates:[");
                            var candidatePaths = new string[]
                            {
                                Environment.CurrentDirectory,
                                System.AppDomain.CurrentDomain.BaseDirectory,
                                System.AppDomain.CurrentDomain.FriendlyName,
                                System.Environment.GetCommandLineArgs().Length > 0 ? System.Environment.GetCommandLineArgs()[0] : null,
                                System.Runtime.InteropServices.RuntimeEnvironment.GetRuntimeDirectory(),
                                System.IO.Path.Combine(Environment.CurrentDirectory, "x.exe.config"),
                                System.IO.Path.Combine("C:\\", "x.config"),
                            };
                            foreach (var c in candidatePaths)
                            {
                                sb.Append("(");
                                sb.Append(c == null ? "<null>" : c.Replace("\\", "/"));
                                sb.Append("=>");
                                try { System.IO.Path.GetFullPath(c); sb.Append("ok"); }
                                catch (System.Exception e) { sb.Append("BAD:").Append(e.GetType().Name); }
                                sb.Append(");");
                            }
                            sb.Append(']');
                            HostDiag = sb.ToString();
                        }
                        catch { HostDiag = cfgEx.Message; }
                    }
                }
                catch (System.Exception cfgEx)
                {
                    trace("config init failed: " + cfgEx);
                    WriteResult(pipeName, "{\"success\":false,\"output\":null,\"error\":" +
                        JsonEscape("config boot failed: " + cfgEx) + "}");
                    return 1;
                }

                string script;
                try
                {
                    script = Encoding.UTF8.GetString(Convert.FromBase64String(scriptB64));
                }
                catch
                {
                    script = scriptB64;
                }

                if (timeoutMs < 1000) timeoutMs = 60000;

                string result;
                using (var ps = PowerShell.Create())
                {
                    trace("PowerShell.Create done");
                    ps.AddScript(script);
                    trace("AddScript done");
                    var output = new System.Collections.ObjectModel.Collection<PSObject>();
                    using (var runspace = RunspaceFactory.CreateRunspace())
                    {
                        trace("CreateRunspace done");
                        runspace.Open();
                        trace("runspace.Open done");
                        ps.Runspace = runspace;

                        var task = System.Threading.Tasks.Task.Factory.StartNew(
                            (Func<System.Collections.ObjectModel.Collection<PSObject>>)(() =>
                            {
                                trace("Invoke start");
                                return ps.Invoke();
                            }));
                        trace("Task started, waiting...");
                        if (!task.Wait(timeoutMs))
                        {
                            trace("Task timeout, stopping");
                            try { ps.Stop(); } catch {}
                            result = "{\"success\":false,\"error\":\"timeout after " + timeoutMs + "ms\"}";
                            WriteResult(pipeName, result);
                            return 1;
                        }
                        trace("Task completed");
                        output = task.Result;
                    }

                    var sb = new StringBuilder();
                    bool first = true;
                    foreach (var o in output)
                    {
                        if (!first) sb.AppendLine();
                        first = false;
                        sb.Append(o == null ? "" : o.ToString());
                    }

                    var errs = ps.Streams.Error;
                    if (errs != null && errs.Count > 0)
                    {
                        sb.AppendLine();
                        sb.Append("[STDERR]");
                        foreach (var e in errs)
                        {
                            sb.AppendLine();
                            sb.Append(e == null ? "" : e.ToString());
                        }
                    }

                    result = "{\"success\":true,\"output\":" + JsonEscape(sb.ToString()) + ",\"error\":null}";
                }

                trace("writing result to pipe");
                WriteResult(pipeName, result);
                trace("done");
                return 0;
            }
            catch (Exception ex)
            {
                trace("EXCEPTION: " + ex.GetType().Name + ": " + ex.Message);
                var errText = ex.ToString();
                if (HostDiag != null && (errText.Contains("Configuration") || errText.Contains("ServicePointManager")))
                    errText += "\r\n---HOST---\r\n" + HostDiag;
                WriteResult(pipeName, "{\"success\":false,\"output\":null,\"error\":" + JsonEscape(errText) + "}");
                return 1;
            }
        }

        private static void WriteResult(string pipeName, string json)
        {
            try
            {
                using (var client = new NamedPipeClientStream(".", pipeName, PipeDirection.Out))
                {
                    client.Connect(15000);
                    var bytes = Encoding.UTF8.GetBytes(json);
                    client.Write(bytes, 0, bytes.Length);
                    client.Flush();
                }
            }
            catch
            {
            }
        }

        private static string JsonEscape(string s)
        {
            if (s == null) return "\"\"";
            var sb = new StringBuilder(s.Length + 16);
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u").Append(((int)c).ToString("x4"));
                        }
                        else
                        {
                            sb.Append(c);
                        }
                        break;
                }
            }
            sb.Append('"');
            return sb.ToString();
        }
    }
}
