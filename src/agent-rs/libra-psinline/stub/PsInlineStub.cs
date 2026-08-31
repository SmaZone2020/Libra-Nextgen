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
                // Framework's ClientConfigPaths then throws "path contains illegal
                // characters" for EVERY PowerShell command (ServicePointManager
                // diagnostics init). AppDomain.SetData("APP_CONFIG_FILE") does NOT
                // affect SetupInformation.ConfigurationFile in .NET Framework — it
                // is a snapshot — so patch the FusionStore field the config system
                // actually reads, and pin a valid empty config file.
                try
                {
                    var cfgPath = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "libra_pwsh_unused.config");
                    if (!System.IO.File.Exists(cfgPath))
                        System.IO.File.WriteAllText(cfgPath, "<?xml version=\"1.0\"?>\r\n<configuration/>\r\n");
                    var storeField = typeof(System.AppDomain).GetField(
                        "_FusionStore",
                        System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                    if (storeField != null)
                    {
                        var store = storeField.GetValue(System.AppDomain.CurrentDomain);
                        var cfgField = store.GetType().GetField(
                            "_configuration_file",
                            System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
                        if (cfgField != null)
                            cfgField.SetValue(store, cfgPath);
                    }
                    System.AppDomain.CurrentDomain.SetData("APP_CONFIG_FILE", cfgPath);
                }
                catch {}

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
                WriteResult(pipeName, "{\"success\":false,\"output\":null,\"error\":" + JsonEscape(ex.ToString()) + "}");
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
