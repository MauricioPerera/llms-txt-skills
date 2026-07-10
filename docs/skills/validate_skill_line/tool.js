// validate_skill_line — validate a single `## Skills` bullet line against the
// llms.txt Skills format (core RFC + Executable Skills v0.4). Pure: no host
// capabilities; runs entirely inside the sandbox.
var LINE_RE = /^\s*-\s+\[([^\]]+)\]\(([^)]*)\):\s*(.*?)\s*(?:<!--\s*skill:\s*(\{.*\})\s*-->)?\s*$/;
var HEX64 = /^[a-fA-F0-9]{64}$/;
registerTool({
  name: "validate_skill_line",
  description: "Validate one '## Skills' bullet line (markdown) against the llms.txt Skills format. Returns valid + errors/warnings with the parsed fields.",
  inputSchema: { type: "object", properties: { line: { type: "string", description: "the markdown bullet line to validate" } }, required: ["line"] },
  handler: function (args) {
    var errors = [];
    var warnings = [];
    var m = LINE_RE.exec(String(args.line || ""));
    if (!m) return { valid: false, errors: ["line does not match `- [name](url): description <!-- skill: {...} -->`"], warnings: [] };
    var name = m[1], url = m[2], desc = m[3], metaRaw = m[4];
    var meta = null;
    if (!url) errors.push("empty url");
    if (!desc || desc.length < 10) warnings.push("description too short (<10 chars)");
    if (metaRaw) {
      try { meta = JSON.parse(metaRaw); } catch (e) { errors.push("inline metadata is not valid JSON: " + e.message); }
      if (meta) {
        if (meta.version !== undefined && !/^\d+\.\d+\.\d+$/.test(String(meta.version))) warnings.push("version is not semver");
        if (meta.sha256 !== undefined && !HEX64.test(String(meta.sha256))) errors.push("sha256 must be 64 hex chars");
        var hasTool = meta.tool !== undefined, hasToolSha = meta.tool_sha256 !== undefined;
        if (hasTool && !hasToolSha) errors.push("'tool' declared without 'tool_sha256' (both required together)");
        if (hasToolSha && !hasTool) errors.push("'tool_sha256' declared without 'tool' (both required together)");
        if (hasToolSha && !HEX64.test(String(meta.tool_sha256))) errors.push("tool_sha256 must be 64 hex chars");
      }
    } else {
      warnings.push("no inline metadata: prose-only skill (fine at L0; add sha256 for L1)");
    }
    return { valid: errors.length === 0, name: name, url: url, description: desc, meta: meta, errors: errors, warnings: warnings };
  }
});
