// get_concept — fetch a full concept document from this origin's OKF bundle.
// The id->url map is embedded at build time (content-addressed via tool_sha256).
var CONCEPTS = {"adoption-ladder.md":"/knowledge/adoption-ladder.md","consuming.md":"/knowledge/consuming.md","executable-skills.md":"/knowledge/executable-skills.md","publishing.md":"/knowledge/publishing.md","trust-model.md":"/knowledge/trust-model.md","what-is-llms-txt-skills.md":"/knowledge/what-is-llms-txt-skills.md"};
registerTool({
  name: "get_concept",
  description: "Fetch the full markdown of a knowledge concept by id (as returned by search_knowledge / list_concepts).",
  inputSchema: { type: "object", properties: { id: { type: "string", description: "concept id, e.g. policies/refunds.md" } }, required: ["id"] },
  handler: async function (args) {
    var url = CONCEPTS[args.id];
    if (!url) throw new Error("unknown concept id: " + args.id);
    var r = await host.fetchOrigin(url);
    if (r.status !== 200) throw new Error("fetch failed: HTTP " + r.status);
    return { id: args.id, markdown: r.body };
  }
});
