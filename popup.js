import { listOrgs, listProjects, addProject, Zip } from "./core.js";

const $ = (id) => document.getElementById(id);
const say = (t, err) => { $("status").textContent = t; $("status").className = err ? "err" : ""; };
let projects = [], orgs = [], currentTabProject = null;

async function tabProject() {
  try {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    const m = (t.url || "").match(/claude\.ai\/project\/([0-9a-f-]{36})/);
    return m ? m[1] : null;
  } catch { return null; }
}

async function loadOrg(orgId) {
  $("list").textContent = "Loading projects…";
  try { projects = await listProjects(orgId); }
  catch (e) { projects = []; $("list").textContent = e.status === 403 ? "No project access in this organization." : "Could not load: " + e.message; $("go").disabled = true; return; }
  if (!projects.length) { $("list").textContent = "No projects in this organization."; $("go").disabled = true; return; }
  $("list").textContent = "";
  for (const p of projects) {
    const l = document.createElement("label");
    const c = document.createElement("input"); c.type = "checkbox"; c.value = p.uuid; c.checked = p.uuid === currentTabProject;
    l.append(c, " ", p.name);
    if (p.archived_at) { const s = document.createElement("span"); s.className = "n"; s.textContent = " (archived)"; l.append(s); }
    $("list").append(l);
  }
  if (!currentTabProject) $("list").querySelectorAll("input").forEach((c) => (c.checked = true));
  $("go").disabled = false;
  say(`${projects.length} projects`);
}

async function init() {
  currentTabProject = await tabProject();
  try { orgs = await listOrgs(); }
  catch (e) { say("Not logged in to claude.ai in this Chrome profile (" + e.message + "). Log in, then reopen.", true); $("list").textContent = ""; return; }
  if (orgs.length > 1) {
    $("org").hidden = false;
    for (const o of orgs) $("org").add(new Option(o.name, o.uuid));
    $("org").onchange = () => loadOrg($("org").value);
  }
  await loadOrg(orgs[0].uuid);
}

$("all").onclick = () => $("list").querySelectorAll("input").forEach((c) => (c.checked = true));
$("none").onclick = () => $("list").querySelectorAll("input").forEach((c) => (c.checked = false));

$("go").onclick = async () => {
  const orgId = $("org").hidden ? orgs[0].uuid : $("org").value;
  const picked = projects.filter((p) => [...$("list").querySelectorAll("input:checked")].some((c) => c.value === p.uuid));
  if (!picked.length) return say("Select at least one project.", true);
  $("go").disabled = true;
  const zip = new Zip(), lines = [];
  for (const p of picked) {
    try {
      const r = await addProject(zip, orgId, p, (m) => say(m));
      lines.push(`${r.name}: ${r.instructions ? "instructions, " : ""}${r.docs} text docs, ${r.files} files` + (r.failed.length ? `, ${r.failed.length} FAILED (see _failed.txt)` : ""));
    } catch (e) { lines.push(`${p.name}: FAILED ${e.message}`); }
  }
  const url = URL.createObjectURL(zip.blob());
  const stamp = new Date().toISOString().slice(0, 10);
  const name = picked.length === 1 ? picked[0].name.replace(/[^\w.-]+/g, "_") : "claude-projects";
  const a = document.createElement("a"); a.href = url; a.download = `${name}-${stamp}.zip`; a.click();
  say(lines.join("\n"));
  $("go").disabled = false;
};

init();
