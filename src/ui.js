const $ = (id) => document.getElementById(id);
let groups = [];

function render() {
  const q = $('filter').value.toLowerCase();
  const box = $('groups');
  box.replaceChildren(...groups.filter((g) => g.name.toLowerCase().includes(q) || g.id.includes(q)).map((g) => {
    const row = document.createElement('label');
    row.className = 'row';
    const cb = Object.assign(document.createElement('input'), { type: 'checkbox', checked: g.enabled });
    cb.onchange = async () => {
      const res = await fetch(`/api/groups/${encodeURIComponent(g.id)}?enabled=${cb.checked}`, { method: 'PUT' });
      if (res.ok) g.enabled = cb.checked; else { cb.checked = g.enabled; alert('Failed to save'); }
    };
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = g.name || '(unnamed)';
    const id = document.createElement('code');
    id.textContent = g.id;
    name.append(id);
    row.append(cb, name);
    return row;
  }));
}

async function load(schedule = true) {
  try {
    const s = await (await fetch('/api/status')).json();
    $('status').textContent = `WhatsApp: ${s.state}`;
    $('qr').hidden = !s.qr;
    if (s.qr) $('qr').src = s.qr;
    $('connect').hidden = !/^(disconnected|error|auth_failure)/.test(s.state);
    $('disconnect').hidden = !['connected', 'pairing'].includes(s.state);
    $('unlink').hidden = !/^(connected|pairing|disconnected|error|auth_failure)/.test(s.state);
    $('filter').hidden = s.state !== 'connected';
    if (s.state === 'connected') {
      const res = await fetch('/api/groups');
      if (res.ok) { groups = await res.json(); render(); }
    } else $('groups').replaceChildren();
  } catch { $('status').textContent = 'Server unavailable'; }
  finally { if (schedule) setTimeout(load, 3000); }
}
async function action(name) {
  $('action-error').textContent = '';
  $('connect').disabled = $('disconnect').disabled = $('unlink').disabled = true;
  try {
    const res = await fetch(`/api/${name}`, { method: 'POST' });
    if (!res.ok) $('action-error').textContent = `Could not ${name}; refresh and try again.`;
    await load(false);
  } catch { $('action-error').textContent = `Could not ${name}; server unavailable.`; }
  finally { $('connect').disabled = $('disconnect').disabled = $('unlink').disabled = false; }
}
$('connect').onclick = () => action('connect');
$('disconnect').onclick = () => action('disconnect');
$('unlink').onclick = () => {
  if (confirm('Unlink this WhatsApp account? The saved pairing and group settings will be removed, then a new QR code will appear.')) action('unlink');
};
$('filter').oninput = render;
load();
