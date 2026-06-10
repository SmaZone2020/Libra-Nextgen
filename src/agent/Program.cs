using System.Text;
using LibraNextgen.Agent.Core;
using LibraNextgen.Agent.Crypto;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

var config = ConfigManager.Load(args);
var crypto = new AgentCrypto();
var engine = new AgentEngine(config, crypto);

Console.CancelKeyPress += (_, e) =>
{
    Console.WriteLine("[Agent] Shutting down...");
    e.Cancel = true;
};

await engine.RunAsync();
