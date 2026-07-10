// list_concepts — enumerate this origin's published knowledge concepts.
// The list is embedded at build time (content-addressed via tool_sha256).
var CONCEPTS = [{"id":"adoption-ladder.md","type":"Documentation","title":"Adoption ladder (L0-L3)","description":"Start minimal, harden later - what each level adds and costs."},{"id":"consuming.md","type":"Playbook","title":"Consuming published skills","description":"The three ways an agent consumes skills today, and when to use each."},{"id":"executable-skills.md","type":"Documentation","title":"Executable skills and origin memory","description":"tool.js sandboxed execution and hash-pinned BM25 search over the site's own content."},{"id":"publishing.md","type":"Playbook","title":"Publishing skills","description":"The two-command publisher flow and the CI guard."},{"id":"trust-model.md","type":"Policy","title":"Trust model","description":"The rings of trust - integrity, authenticity, attestation - and what each defends against."},{"id":"what-is-llms-txt-skills.md","type":"Documentation","title":"What is llms.txt Skills","description":"The one-paragraph definition of the standard and the problem it solves."}];
registerTool({
  name: "list_concepts",
  description: "List all knowledge concepts published by this origin (id, type, title, description).",
  inputSchema: { type: "object", properties: {} },
  handler: function () { return { concepts: CONCEPTS }; }
});
