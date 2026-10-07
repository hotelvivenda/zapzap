import { useEffect, useRef, useState } from 'react';


const brl = (cents) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Aceita "1260", "1.260,50", "R$ 1260,5" e devolve centavos (ou null se inválido).
function parseBRL(text) {
  const t = text.replace(/[R$\s.]/g, '').replace(',', '.');
  if (t === '') return 0;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

// Cliente parado na etapa por mais dias do que o aviso da etapa permite.
const lateDays = (c, stages) => {
  const st = stages.find((s) => s.key === c.stage);
  if (!st || st.is_final) return null;
  return st.alert_days && c.days_in_stage >= st.alert_days ? c.days_in_stage : null;
};
// Follow-up: datas no formato AAAA-MM-DD, comparadas com o dia de hoje no aparelho de quem usa.
const pad2 = (n) => String(n).padStart(2, '0');
const addDays = (n) => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
};
const daysUntil = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date();
  return Math.round((new Date(y, m - 1, d) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000);
};
const followDue = (c) => !!c.followup_at && daysUntil(c.followup_at) <= 0;
const followLabel = (iso) => {
  const n = daysUntil(iso);
  const [, m, d] = iso.split('-');
  if (n < 0) return `Follow-up atrasado ${-n} dia${n === -1 ? '' : 's'} (${d}/${m})`;
  if (n === 0) return 'Follow-up hoje';
  if (n === 1) return 'Follow-up amanhã';
  return `Follow-up em ${n} dias (${d}/${m})`;
};

// Troca {nome} e {atendente} nas respostas prontas.
const fillReply = (body, contact, user) =>
  body
    .replaceAll('{nome}', (contact?.name || '').trim().split(/\s+/)[0] || 'tudo bem')
    .replaceAll('{atendente}', (user?.name || '').trim().split(/\s+/)[0] || '');

const daysLabel = (n) => (n === 0 ? 'hoje' : `há ${n} dia${n === 1 ? '' : 's'}`);

let onUnauthorized = () => {};

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') onUnauthorized();
  if (!res.ok) throw new Error(data.error || 'Erro');
  return data;
}

export default function App() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    onUnauthorized = () => setMe((m) => (m ? { ...m, authenticated: false } : m));
    api('/me').then(setMe).catch(() => setMe({ auth: true, authenticated: false }));
  }, []);
  if (!me) return null;
  if (!me.authenticated) return <Login onDone={() => api('/me').then(setMe)} />;
  return (
    <Crm
      me={me}
      onLogout={() => api('/logout', { method: 'POST' }).then(() => setMe({ ...me, authenticated: false }))}
      onUserChange={(user) => setMe({ ...me, user })}
    />
  );
}

function Login({ onDone }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/login', { method: 'POST', body: { username, password } });
      onDone();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form onSubmit={submit}>
        <h1>ZapZap CRM</h1>
        <label htmlFor="usuario">Usuário</label>
        <input id="usuario" autoComplete="username" autoCapitalize="none" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        <label htmlFor="senha">Senha</label>
        <input id="senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button disabled={busy || !password || !username}>Entrar</button>
      </form>
    </div>
  );
}

function Crm({ me, onLogout, onUserChange }) {
  const isAdmin = me.user?.role === 'admin';
  const [config, setConfig] = useState({ provider: '', stages: [] });
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [view, setView] = useState('conversas');
  const [dialogStage, setDialogStage] = useState(null);
  const [replies, setReplies] = useState([]);
  const [picker, setPicker] = useState(false);
  const [info, setInfo] = useState('');
  const inputRef = useRef(null);
  const endRef = useRef(null);

  const selected = contacts.find((c) => c.id === selectedId);
  const stageName = (key) => config.stages.find((s) => s.key === key)?.name ?? key;
  const isFinal = (key) => !!config.stages.find((s) => s.key === key)?.is_final;

  const loadContacts = () => api(`/contacts?q=${encodeURIComponent(q)}`).then(setContacts).catch(() => {});
  const loadMessages = (id) => api(`/contacts/${id}/messages`).then(setMessages).catch(() => {});

  const loadReplies = () => api('/replies').then(setReplies).catch(() => {});
  useEffect(() => { api('/config').then(setConfig); loadReplies(); }, []);
  useEffect(() => {
    loadContacts();
    const t = setInterval(loadContacts, 4000);
    return () => clearInterval(t);
  }, [q]);
  useEffect(() => {
    if (!selectedId) return;
    loadMessages(selectedId);
    const t = setInterval(() => loadMessages(selectedId), 3000);
    return () => clearInterval(t);
  }, [selectedId]);
  useEffect(() => endRef.current?.scrollIntoView(), [messages]);

  const run = async (fn) => {
    setError('');
    try { await fn(); } catch (e) { setError(e.message); }
  };

  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    run(async () => {
      await api(`/contacts/${selectedId}/messages`, { method: 'POST', body: { text } });
      setText('');
      setPicker(false);
      if (followDue(selected)) {
        await api(`/contacts/${selectedId}`, { method: 'PATCH', body: { followup_at: null } });
        setInfo('Follow-up concluído. Se precisar, marque uma nova data em Próximo contato.');
        setTimeout(() => setInfo(''), 6000);
      }
      loadMessages(selectedId);
      loadContacts();
    });
  };

  const update = (patch) =>
    run(async () => {
      await api(`/contacts/${selectedId}`, { method: 'PATCH', body: patch });
      loadContacts();
    });

  const setFollowup = (value) => {
    setContacts((cs) => cs.map((c) => (c.id === selectedId ? { ...c, followup_at: value } : c)));
    update({ followup_at: value });
  };

  const moveStage = (id, stage) => {
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, stage, days_in_stage: 0, ...(isFinal(stage) ? { followup_at: null } : {}) } : c)));
    run(async () => {
      await api(`/contacts/${id}`, { method: 'PATCH', body: { stage } });
      loadContacts();
    });
  };

  const openChat = (id) => {
    setSelectedId(id);
    setView('conversas');
  };

  const addContact = (form) =>
    run(async () => {
      const value_cents = parseBRL(form.value || '');
      if (value_cents === null) throw new Error('Valor inválido. Exemplo: 1260,00');
      const c = await api('/contacts', {
        method: 'POST',
        body: { phone: form.phone, name: form.name, stage: form.stage || undefined, value_cents },
      });
      setDialog(null);
      await loadContacts();
      if (view === 'conversas') setSelectedId(c.id);
    });

  const reloadStages = () => api('/config').then(setConfig);

  const simulate = (form) =>
    run(async () => {
      await api('/dev/incoming', {
        method: 'POST',
        body: { phone: selected.phone, name: selected.name, text: form.text },
      });
      setDialog(null);
      loadMessages(selectedId);
      loadContacts();
    });

  return (
    <div className="shell">
      <nav className="tabs">
        <strong>ZapZap CRM</strong>
        <button className={view === 'conversas' ? 'tab on' : 'tab'} onClick={() => setView('conversas')}>Conversas</button>
        <button className={view === 'funil' ? 'tab on' : 'tab'} onClick={() => setView('funil')}>Funil</button>
        {isAdmin && <button className={view === 'respostas' ? 'tab on' : 'tab'} onClick={() => setView('respostas')}>Respostas</button>}
        <button className={view === 'equipe' ? 'tab on' : 'tab'} onClick={() => setView('equipe')}>Equipe</button>
        <span className={`badge ${config.provider}`}>
          {config.provider === 'cloud' ? 'WhatsApp conectado' : 'Modo teste'}
        </span>
        {me.demo && <DemoSwitch me={me} onChange={onUserChange} />}
        <span className="who" title={me.user?.role === 'admin' ? 'Administrador' : 'Atendente'}>{me.user?.name}</span>
        {me.auth && <button className="ghost" onClick={onLogout}>Sair</button>}
      </nav>
      {error && view === 'funil' && <div className="error">{error}</div>}
      {view === 'respostas' && isAdmin ? (
        <Replies replies={replies} onChanged={loadReplies} />
      ) : view === 'equipe' ? (
        <Team key={me.user.id} me={me} />
      ) : view === 'funil' ? (
        <Board
          contacts={contacts}
          stages={config.stages}
          onMove={moveStage}
          onOpen={openChat}
          onAdd={(key) => { setError(''); setDialogStage(key); setDialog('new'); }}
          onChanged={() => { reloadStages(); loadContacts(); }}
          onError={setError}
          canEdit={isAdmin}
        />
      ) : (
    <div className="app">
      <aside className="list">
        <div className="search">
          <input placeholder="Buscar nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={() => { setDialogStage(null); setDialog('new'); }}>+ Novo</button>
        </div>
        <ul>
          {contacts.map((c) => (
            <li key={c.id} className={c.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(c.id)}>
              <strong>{c.name || c.phone}</strong>
              <span className={`stage ${c.stage}`}>
                {stageName(c.stage)}
                {c.value_cents > 0 && ` · ${brl(c.value_cents)}`}
              </span>
              {lateDays(c, config.stages) !== null && (
                <span className="late-tag">⚠ Parado {daysLabel(c.days_in_stage)}</span>
              )}
              {followDue(c) && <span className="follow-tag due">{followLabel(c.followup_at)}</span>}
              <small>{c.last_body || 'Sem mensagens'}</small>
            </li>
          ))}
          {!contacts.length && <p className="empty">Nenhum contato ainda. Clique em “+ Novo”.</p>}
        </ul>
      </aside>

      <main className="chat">
        {!selected ? (
          <p className="empty">Selecione uma conversa</p>
        ) : (
          <>
            <header>
              <div>
                <strong>{selected.name || 'Sem nome'}</strong>
                <small>{selected.phone}</small>
              </div>
              <select value={selected.stage} onChange={(e) => update({ stage: e.target.value })}>
                {config.stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
              </select>
              {config.provider === 'mock' && <button onClick={() => setDialog('sim')}>Simular resposta</button>}
            </header>
            <div className="messages">
              {messages.map((m) => (
                <div key={m.id} className={`msg ${m.direction}`}>
                  {m.direction === 'out' && m.author_name && <span className="author">{m.author_name}</span>}
                  {m.body}
                  <time>{new Date(m.created_at + 'Z').toLocaleString('pt-BR')}</time>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {error && <div className="error">{error}</div>}
            {info && <div className="notice">{info}</div>}
            {(picker || text.startsWith('/')) && (
              <div className="replies" role="listbox" aria-label="Respostas prontas">
                {replies
                  .filter((r) => !text.startsWith('/') || r.title.toLowerCase().includes(text.slice(1).trim().toLowerCase()))
                  .map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      role="option"
                      onClick={() => {
                        setText(fillReply(r.body, selected, me.user));
                        setPicker(false);
                        inputRef.current?.focus();
                      }}
                    >
                      <strong>{r.title}</strong>
                      <span>{fillReply(r.body, selected, me.user)}</span>
                    </button>
                  ))}
                {!replies.length && <p className="empty">Nenhuma resposta pronta cadastrada.</p>}
              </div>
            )}
            <form onSubmit={send}>
              <button type="button" className="ghost" aria-expanded={picker} onClick={() => setPicker(!picker)}>Respostas</button>
              <textarea
                ref={inputRef}
                rows={2}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send(e);
                  }
                }}
                placeholder="Digite uma mensagem ou / para respostas prontas (Enter envia, Shift+Enter quebra a linha)"
              />
              <button>Enviar</button>
            </form>
          </>
        )}
      </main>

      {dialog && (
        <Dialog
          kind={dialog}
          stages={config.stages}
          initialStage={dialogStage}
          error={error}
          onCancel={() => { setDialog(null); setError(''); }}
          onSubmit={dialog === 'new' ? addContact : simulate}
        />
      )}

      {selected && (
        <aside className="details">
          <h2>Detalhes</h2>
          <label>Nome</label>
          <input key={selected.id + 'n' + (selected.name || '')} defaultValue={selected.name || ''} onBlur={(e) => update({ name: e.target.value })} />
          <label htmlFor="valor">Valor da negociação (R$)</label>
          <input
            id="valor"
            key={selected.id + 'v' + selected.value_cents}
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={selected.value_cents ? (selected.value_cents / 100).toFixed(2).replace('.', ',') : ''}
            onBlur={(e) => {
              const cents = parseBRL(e.target.value);
              if (cents === null) return setError('Valor inválido. Exemplo: 1260,00');
              update({ value_cents: cents });
            }}
          />
          {isFinal(selected.stage) ? (
            <>
              <label>Próximo contato</label>
              <p className="hint">
                Esta etapa é final, então não há follow-up. Se este cliente voltar a escrever, ele reaparece na primeira etapa e você pode marcar um novo contato.
              </p>
            </>
          ) : (
            <>
              <label htmlFor="followup">Próximo contato</label>
              <input id="followup" type="date" value={selected.followup_at || ''} onChange={(e) => setFollowup(e.target.value || null)} />
              <div className="quick-dates">
                <button type="button" className="ghost" onClick={() => setFollowup(addDays(1))}>Amanhã</button>
                <button type="button" className="ghost" onClick={() => setFollowup(addDays(3))}>Em 3 dias</button>
                <button type="button" className="ghost" onClick={() => setFollowup(addDays(7))}>Em 1 semana</button>
                {selected.followup_at && <button type="button" className="ghost" onClick={() => setFollowup(null)}>Limpar</button>}
              </div>
              {selected.followup_at && (
                <p className={`follow-tag ${followDue(selected) ? 'due' : ''}`}>{followLabel(selected.followup_at)}</p>
              )}
            </>
          )}
          <label>Anotações</label>
          <textarea key={selected.id + 't' + selected.notes} defaultValue={selected.notes} onBlur={(e) => update({ notes: e.target.value })} />
        </aside>
      )}
    </div>
      )}
      {dialog && view === 'funil' && (
        <Dialog
          kind={dialog}
          stages={config.stages}
          initialStage={dialogStage}
          error={error}
          onCancel={() => { setDialog(null); setError(''); }}
          onSubmit={addContact}
        />
      )}
    </div>
  );
}

function Board({ contacts, stages, onMove, onOpen, onAdd, onChanged, onError, canEdit }) {
  const [over, setOver] = useState(null);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const needsAttention = contacts
    .filter((c) => lateDays(c, stages) !== null || followDue(c))
    .sort((x, y) => (followDue(y) ? -daysUntil(y.followup_at) + 1000 : y.days_in_stage) - (followDue(x) ? -daysUntil(x.followup_at) + 1000 : x.days_in_stage));
  const reasons = (c) =>
    [followDue(c) && followLabel(c.followup_at), lateDays(c, stages) !== null && `parado ${daysLabel(c.days_in_stage)}`].filter(Boolean);

  const call = async (path, method, body) => {
    onError('');
    try {
      await api(path, { method, body });
      onChanged();
    } catch (e) {
      onError(e.message);
    }
  };

  const move = (idx, dir) => {
    const keys = stages.map((s) => s.key);
    [keys[idx], keys[idx + dir]] = [keys[idx + dir], keys[idx]];
    call('/stages/order', 'PUT', { keys });
  };

  const drop = (e, stage) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const c = contacts.find((x) => x.id === id);
    if (c && c.stage !== stage) onMove(id, stage);
  };

  return (
    <>
      <div className="toolbar">
        {canEdit && <button className={editing ? '' : 'ghost'} onClick={() => { setEditing(!editing); setConfirmDel(null); onError(''); }}>
          {editing ? 'Concluir edição' : 'Editar etapas'}
        </button>}
        {editing && (
          <p className="hint edit-hint">
            <strong>Etapa final</strong>: o cliente já foi resolvido (fechado ou perdido). Não tem follow-up nem aviso de parado e, se ele voltar a escrever, reaparece na primeira etapa.
          </p>
        )}
        {editing && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              call('/stages', 'POST', { name: newName });
              setNewName('');
            }}
          >
            <input aria-label="Nome da nova etapa" placeholder="Nome da nova etapa" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button>+ Nova etapa</button>
          </form>
        )}
      </div>
      {needsAttention.length > 0 && (
        <div className="alert" role="status">
          <strong>
            ⚠ {needsAttention.length} {needsAttention.length === 1 ? 'cliente precisa' : 'clientes precisam'} de atenção
          </strong>
          <ul className="alert-list">
            {needsAttention.map((c) => (
              <li key={c.id}>
                <button className="link" onClick={() => onOpen(c.id)}>{c.name || c.phone}</button>
                <span>
                  {stages.find((s) => s.key === c.stage)?.name} · {reasons(c).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="board" style={{ '--cols': stages.length }}>
        {stages.map((stage, idx) => {
          const items = contacts.filter((c) => c.stage === stage.key);
          return (
            <section
              key={stage.key}
              className={`col ${over === stage.key ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(stage.key); }}
              onDragLeave={() => setOver((o) => (o === stage.key ? null : o))}
              onDrop={(e) => drop(e, stage.key)}
            >
              {editing ? (
                <div className="col-edit">
                  <input
                    aria-label={`Nome da etapa ${stage.name}`}
                    key={stage.key + stage.name}
                    defaultValue={stage.name}
                    onBlur={(e) => {
                      const v = e.target.value.trim();
                      if (v && v !== stage.name) call(`/stages/${stage.key}`, 'PATCH', { name: v });
                    }}
                  />
                  <label className="final-check">
                    <input
                      type="checkbox"
                      checked={!!stage.is_final}
                      disabled={idx === 0}
                      onChange={(e) => call(`/stages/${stage.key}`, 'PATCH', { is_final: e.target.checked })}
                    />
                    Etapa final
                  </label>
                  {!stage.is_final && (
                  <label className="alert-days">
                    Avisar após (dias)
                    <input
                      type="number"
                      min="1"
                      max="365"
                      placeholder="sem aviso"
                      key={stage.key + 'a' + stage.alert_days}
                      defaultValue={stage.alert_days ?? ''}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        const days = v === '' ? null : Number(v);
                        if (days !== stage.alert_days) call(`/stages/${stage.key}`, 'PATCH', { alert_days: days });
                      }}
                    />
                  </label>
                  )}
                  <div className="col-actions">
                    <button className="ghost" aria-label="Mover para a esquerda" disabled={idx === 0} onClick={() => move(idx, -1)}>◀</button>
                    <button className="ghost" aria-label="Mover para a direita" disabled={idx === stages.length - 1} onClick={() => move(idx, 1)}>▶</button>
                    {confirmDel === stage.key ? (
                      <button className="danger" onClick={() => { setConfirmDel(null); call(`/stages/${stage.key}`, 'DELETE'); }}>Confirmar exclusão</button>
                    ) : (
                      <button className="ghost" onClick={() => setConfirmDel(stage.key)}>Excluir</button>
                    )}
                  </div>
                </div>
              ) : (
                <h3>
                  {stage.name} <span>{items.length}</span>
                </h3>
              )}
              <p className="total">{brl(items.reduce((s, c) => s + c.value_cents, 0))}</p>
              {items.map((c) => (
                <article
                  key={c.id}
                  className={`card ${lateDays(c, stages) !== null || followDue(c) ? 'late' : ''}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
                  onClick={() => onOpen(c.id)}
                >
                  <strong>{c.name || c.phone}</strong>
                  {c.value_cents > 0 && <span className="value">{brl(c.value_cents)}</span>}
                  {lateDays(c, stages) !== null && <span className="late-tag">⚠ Parado {daysLabel(c.days_in_stage)}</span>}
                  {c.followup_at && <span className={`follow-tag ${followDue(c) ? 'due' : ''}`}>{followLabel(c.followup_at)}</span>}
                  <small>{c.last_body || 'Sem mensagens'}</small>
                  <select
                    aria-label="Mover para etapa"
                    value={c.stage}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => onMove(c.id, e.target.value)}
                  >
                    {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
                  </select>
                </article>
              ))}
              {!items.length && <p className="empty">Arraste um cliente para cá</p>}
              <button className="add ghost" onClick={() => onAdd(stage.key)}>+ Adicionar cliente</button>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Dialog({ kind, stages, initialStage, error, onCancel, onSubmit }) {
  const [form, setForm] = useState({ phone: '', name: '', text: '', value: '', stage: initialStage || stages[0]?.key || '' });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const isNew = kind === 'new';
  return (
    <div className="overlay" onClick={onCancel}>
      <form
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); onSubmit(form); }}
      >
        <h2>{isNew ? 'Novo contato' : 'Simular mensagem do cliente'}</h2>
        {isNew ? (
          <>
            <label htmlFor="d-name">Nome</label>
            <input id="d-name" value={form.name} onChange={set('name')} placeholder="Maria Souza" autoFocus />
            <label htmlFor="d-phone">Telefone com DDI e DDD</label>
            <input id="d-phone" value={form.phone} onChange={set('phone')} placeholder="5511999998888" />
            <label htmlFor="d-stage">Etapa do funil</label>
            <select id="d-stage" value={form.stage} onChange={set('stage')}>
              {stages.map((s) => <option key={s.key} value={s.key}>{s.name}</option>)}
            </select>
            <label htmlFor="d-value">Valor da negociação (R$), se já houver</label>
            <input id="d-value" inputMode="decimal" value={form.value} onChange={set('value')} placeholder="0,00" />
          </>
        ) : (
          <>
            <label htmlFor="d-text">O que o cliente escreveu</label>
            <input id="d-text" value={form.text} onChange={set('text')} placeholder="Tem vaga para sábado?" autoFocus />
          </>
        )}
        {error && <div className="error">{error}</div>}
        <div className="actions">
          <button type="button" className="ghost" onClick={onCancel}>Cancelar</button>
          <button>{isNew ? 'Salvar' : 'Receber mensagem'}</button>
        </div>
      </form>
    </div>
  );
}

function DemoSwitch({ me, onChange }) {
  const [users, setUsers] = useState([]);
  useEffect(() => { api('/users').then(setUsers).catch(() => {}); }, []);
  return (
    <label className="demo-switch">
      Atendendo como
      <select
        value={me.user.id}
        onChange={async (e) => onChange(await api('/demo/as', { method: 'POST', body: { id: Number(e.target.value) } }))}
      >
        {users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    </label>
  );
}

const ROLE_LABELS = { admin: 'Administrador', atendente: 'Atendente' };

function Team({ me }) {
  const isAdmin = me.user.role === 'admin';
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [mine, setMine] = useState({ current: '', password: '' });
  const [fresh, setFresh] = useState({ name: '', username: '', password: '', role: 'atendente' });
  const [resetFor, setResetFor] = useState(null);
  const [resetPw, setResetPw] = useState('');
  const [confirmOff, setConfirmOff] = useState(null);

  const load = () => isAdmin && api('/users').then(setUsers).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const run = async (fn, ok) => {
    setError('');
    setNotice('');
    try {
      await fn();
      if (ok) setNotice(ok);
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="team">
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <section className="panel">
        <h2>Minha conta</h2>
        <p className="hint">Você está como <strong>{me.user.name}</strong> ({ROLE_LABELS[me.user.role]}). Este nome aparece nas mensagens que você envia.</p>
        {me.auth ? (
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('/me/password', { method: 'POST', body: mine });
                setMine({ current: '', password: '' });
              }, 'Senha alterada.');
            }}
          >
            <div>
              <label htmlFor="p-atual">Senha atual</label>
              <input id="p-atual" type="password" autoComplete="current-password" value={mine.current} onChange={(e) => setMine({ ...mine, current: e.target.value })} />
            </div>
            <div>
              <label htmlFor="p-nova">Nova senha (mínimo 8 caracteres)</label>
              <input id="p-nova" type="password" autoComplete="new-password" value={mine.password} onChange={(e) => setMine({ ...mine, password: e.target.value })} />
            </div>
            <button disabled={!mine.current || !mine.password}>Alterar senha</button>
          </form>
        ) : (
          <p className="hint">O login ainda não está ativado neste sistema.</p>
        )}
      </section>

      {isAdmin && me.auth && (
        <>
          <section className="panel">
            <h2>Atendentes</h2>
            <ul className="users">
              {users.map((u) => (
                <li key={u.id} className={u.active ? '' : 'off'}>
                  <div className="u-main">
                    <input
                      aria-label={`Nome de ${u.name}`}
                      key={u.id + u.name}
                      defaultValue={u.name}
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== u.name) run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { name: v } }));
                      }}
                    />
                    <small>usuário: {u.username}{!u.active && ' · desativado'}</small>
                  </div>
                  <select
                    aria-label={`Acesso de ${u.name}`}
                    value={u.role}
                    onChange={(e) => run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }))}
                  >
                    <option value="atendente">Atendente</option>
                    <option value="admin">Administrador</option>
                  </select>
                  {resetFor === u.id ? (
                    <form
                      className="inline"
                      onSubmit={(e) => {
                        e.preventDefault();
                        run(async () => {
                          await api(`/users/${u.id}`, { method: 'PATCH', body: { password: resetPw } });
                          setResetFor(null);
                          setResetPw('');
                        }, `Nova senha de ${u.name} definida.`);
                      }}
                    >
                      <input aria-label="Nova senha" type="text" autoComplete="off" placeholder="Nova senha" value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
                      <button>Salvar</button>
                      <button type="button" className="ghost" onClick={() => setResetFor(null)}>Cancelar</button>
                    </form>
                  ) : (
                    <button className="ghost" onClick={() => { setResetFor(u.id); setResetPw(''); }}>Redefinir senha</button>
                  )}
                  {u.id !== me.user.id &&
                    (confirmOff === u.id ? (
                      <button className="danger" onClick={() => { setConfirmOff(null); run(() => api(`/users/${u.id}`, { method: 'PATCH', body: { active: !u.active } })); }}>
                        Confirmar
                      </button>
                    ) : (
                      <button className="ghost" onClick={() => setConfirmOff(u.id)}>{u.active ? 'Desativar' : 'Reativar'}</button>
                    ))}
                </li>
              ))}
            </ul>
            <p className="hint">Quem é desativado perde o acesso na hora, mas as mensagens que enviou continuam com o nome dele.</p>
          </section>

          <section className="panel">
            <h2>Novo atendente</h2>
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await api('/users', { method: 'POST', body: fresh });
                  setFresh({ name: '', username: '', password: '', role: 'atendente' });
                }, 'Atendente criado. Passe o usuário e a senha para ele.');
              }}
            >
              <div>
                <label htmlFor="n-nome">Nome (aparece nas mensagens)</label>
                <input id="n-nome" value={fresh.name} onChange={(e) => setFresh({ ...fresh, name: e.target.value })} placeholder="Carla" />
              </div>
              <div>
                <label htmlFor="n-user">Usuário para entrar</label>
                <input id="n-user" autoCapitalize="none" value={fresh.username} onChange={(e) => setFresh({ ...fresh, username: e.target.value })} placeholder="carla" />
              </div>
              <div>
                <label htmlFor="n-senha">Senha inicial</label>
                <input id="n-senha" type="text" autoComplete="off" value={fresh.password} onChange={(e) => setFresh({ ...fresh, password: e.target.value })} placeholder="mínimo 8 caracteres" />
              </div>
              <div>
                <label htmlFor="n-papel">Acesso</label>
                <select id="n-papel" value={fresh.role} onChange={(e) => setFresh({ ...fresh, role: e.target.value })}>
                  <option value="atendente">Atendente</option>
                  <option value="admin">Administrador</option>
                </select>
              </div>
              <button disabled={!fresh.name || !fresh.username || !fresh.password}>Criar atendente</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

function Replies({ replies, onChanged }) {
  const [error, setError] = useState('');
  const [fresh, setFresh] = useState({ title: '', body: '' });
  const [confirmDel, setConfirmDel] = useState(null);

  const run = async (fn) => {
    setError('');
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <div className="team">
      {error && <div className="error">{error}</div>}
      <section className="panel">
        <h2>Respostas prontas</h2>
        <p className="hint">
          Textos que a equipe usa com frequência. Na conversa, clique em <strong>Respostas</strong> ou digite <strong>/</strong> para escolher.
          Escreva <strong>{'{nome}'}</strong> onde entra o primeiro nome do cliente e <strong>{'{atendente}'}</strong> onde entra o primeiro nome de quem está atendendo.
        </p>
        <ul className="users">
          {replies.map((r) => (
            <li key={r.id} className="reply-row">
              <input
                aria-label={`Título de ${r.title}`}
                key={r.id + r.title}
                defaultValue={r.title}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== r.title) run(() => api(`/replies/${r.id}`, { method: 'PATCH', body: { title: v } }));
                }}
              />
              <textarea
                aria-label={`Texto de ${r.title}`}
                key={r.id + r.body}
                defaultValue={r.body}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== r.body) run(() => api(`/replies/${r.id}`, { method: 'PATCH', body: { body: v } }));
                }}
              />
              {confirmDel === r.id ? (
                <button className="danger" onClick={() => { setConfirmDel(null); run(() => api(`/replies/${r.id}`, { method: 'DELETE' })); }}>Confirmar exclusão</button>
              ) : (
                <button className="ghost" onClick={() => setConfirmDel(r.id)}>Excluir</button>
              )}
            </li>
          ))}
        </ul>
      </section>
      <section className="panel">
        <h2>Nova resposta pronta</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              await api('/replies', { method: 'POST', body: fresh });
              setFresh({ title: '', body: '' });
            });
          }}
        >
          <label htmlFor="r-titulo">Título (para achar rápido)</label>
          <input id="r-titulo" value={fresh.title} onChange={(e) => setFresh({ ...fresh, title: e.target.value })} placeholder="Horário de check-in" />
          <label htmlFor="r-texto">Texto</label>
          <textarea id="r-texto" value={fresh.body} onChange={(e) => setFresh({ ...fresh, body: e.target.value })} placeholder="Olá, {nome}! ..." />
          <button disabled={!fresh.title.trim() || !fresh.body.trim()}>Salvar resposta</button>
        </form>
      </section>
    </div>
  );
}
