using LibraNextgen.Service.Data;
using LibraNextgen.Service.Models;
using MongoDB.Driver;

namespace LibraNextgen.Service.Services.Builder;

/// <summary>
/// </summary>
public class BuildListService
{
    private readonly Repository<BuildTrafficLists> _lists;

    public BuildListService(Repository<BuildTrafficLists> lists)
    {
        _lists = lists;
    }

    public async Task<BuildTrafficLists> GetAsync(CancellationToken ct = default)
    {
        var doc = await _lists.GetByIdAsync("traffic", ct);
        if (doc != null)
            return doc;
        doc = new BuildTrafficLists
        {
            UserAgents = Default("userAgents").Select(v => new BuildListItem { Value = v }).ToList(),
            ExtraHeaders = Default("extraHeaders").Select(v => new BuildListItem { Value = v }).ToList(),
            PathSuffixes = Default("pathSuffixes").Select(v => new BuildListItem { Value = v }).ToList(),
        };
        try
        {
            await _lists.InsertAsync(doc, ct);
        }
        catch (MongoWriteException)
        {
            doc = await _lists.GetByIdAsync("traffic", ct) ?? doc;
        }
        return doc;
    }

    private static List<BuildListItem> Pick(BuildTrafficLists doc, string list) => list switch
    {
        "userAgents" => doc.UserAgents,
        "extraHeaders" => doc.ExtraHeaders,
        "pathSuffixes" => doc.PathSuffixes,
        _ => new List<BuildListItem>(),
    };

    public async Task<BuildTrafficLists> AddItemAsync(string list, string value, CancellationToken ct = default)
    {
        var doc = await GetAsync(ct);
        var items = Pick(doc, list);
        items.Add(new BuildListItem { Value = value, Enabled = true });
        await SaveAsync(doc, ct);
        return doc;
    }

    public async Task<BuildTrafficLists> ToggleItemAsync(string list, string id, bool enabled, CancellationToken ct = default)
    {
        var doc = await GetAsync(ct);
        var items = Pick(doc, list);
        var item = items.FirstOrDefault(i => i.Id == id);
        if (item == null)
            throw new KeyNotFoundException($"item '{id}' not found in '{list}'");
        item.Enabled = enabled;
        await SaveAsync(doc, ct);
        return doc;
    }

    public async Task<BuildTrafficLists> DeleteItemAsync(string list, string id, CancellationToken ct = default)
    {
        var doc = await GetAsync(ct);
        var items = Pick(doc, list);
        var removed = items.RemoveAll(i => i.Id == id);
        if (removed == 0)
            throw new KeyNotFoundException($"item '{id}' not found in '{list}'");
        await SaveAsync(doc, ct);
        return doc;
    }

    private async Task SaveAsync(BuildTrafficLists doc, CancellationToken ct)
    {
        await _lists.UpdateAsync("traffic",
            Builders<BuildTrafficLists>.Update
                .Set(d => d.UserAgents, doc.UserAgents)
                .Set(d => d.ExtraHeaders, doc.ExtraHeaders)
                .Set(d => d.PathSuffixes, doc.PathSuffixes),
            ct);
    }

    private static List<string> Default(string list) => list switch
    {
        "userAgents" =>
        [
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
        ],
        "extraHeaders" =>
        [
            "Accept: application/json, text/plain, */*",
            "Accept-Language: zh-CN,zh;q=0.9,en;q=0.8",
            "X-Requested-With: XMLHttpRequest",
        ],
        "pathSuffixes" =>
        [
            "user/info", "orders/list", "profile", "settings",
            "notifications", "messages/unread", "search/history", "dashboard/stats",
        ],
        _ => new List<string>(),
    };
}
