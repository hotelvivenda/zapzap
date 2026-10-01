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
  const limit = stages.find((s) => s.key === c.stage)?.alert_days;
  return limit && c.days_in_stage >= limit ? c.days_in_stage : null;
};
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
  if (!me.authenticated) return <Login onDone={() => setMe({ ...me, authenticated: true })} />;
  return (
    <Crm
      canLogout={me.auth}
      onLogout={() => api('/logout', { method: 'POST' }).then(() => setMe({ ...me, authenticated: false }))}
    />
  );
}

function Login({ onDone }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/login', { method: 'POST', body: { password } });
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
        <label htmlFor="senha">Senha de acesso</label>
        <input id="senha" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="error">{error}</div>}
        <button disabled={busy || !password}>Entrar</button>
      </form>
    </div>
  );
}

function Crm({ canLogout, onLogout }) {
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
  const endRef = useRef(null);

  const selected = contacts.find((c) => c.id === selectedId);
  const stageName = (key) => config.stages.find((s) => s.key === key)?.name ?? key;

  const loadContacts = () => api(`/contacts?q=${encodeURIComponent(q)}`).then(setContacts).catch(() => {});
  const loadMessages = (id) => api(`/contacts/${id}/messages`).then(setMessages).catch(() => {});

  useEffect(() => { api('/config').then(setConfig); }, []);
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
      loadMessages(selectedId);
      loadContacts();
    });
  };

  const update = (patch) =>
    run(async () => {
      await api(`/contacts/${selectedId}`, { method: 'PATCH', body: patch });
      loadContacts();
    });

  const moveStage = (id, stage) => {
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, stage, days_in_stage: 0 } : c)));
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
        <span className={`badge ${config.provider}`}>
          {config.provider === 'cloud' ? 'WhatsApp conectado' : 'Modo teste'}
        </span>
        {canLogout && <button className="ghost" onClick={onLogout}>Sair</button>}
      </nav>
      {error && view === 'funil' && <div className="error">{error}</div>}
      {view === 'funil' ? (
        <Board
          contacts={contacts}
          stages={config.stages}
          onMove={moveStage}
          onOpen={openChat}
          onAdd={(key) => { setError(''); setDialogStage(key); setDialog('new'); }}
          onChanged={() => { reloadStages(); loadContacts(); }}
          onError={setError}
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
                  {m.body}
                  <time>{new Date(m.created_at + 'Z').toLocaleString('pt-BR')}</time>
                </div>
              ))}
              <div ref={endRef} />
            </div>
            {error && <div className="error">{error}</div>}
            <form onSubmit={send}>
              <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Digite uma mensagem" />
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
          <input key={selected.id + 'n'} defaultValue={selected.name || ''} onBlur={(e) => update({ name: e.target.value })} />
          <label htmlFor="valor">Valor da negociação (R$)</label>
          <input
            id="valor"
            key={selected.id + 'v'}
            inputMode="decimal"
            placeholder="0,00"
            defaultValue={selected.value_cents ? (selected.value_cents / 100).toFixed(2).replace('.', ',') : ''}
            onBlur={(e) => {
              const cents = parseBRL(e.target.value);
              if (cents === null) return setError('Valor inválido. Exemplo: 1260,00');
              update({ value_cents: cents });
            }}
          />
          <label>Anotações</label>
          <textarea key={selected.id + 't'} defaultValue={selected.notes} onBlur={(e) => update({ notes: e.target.value })} />
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

function Board({ contacts, stages, onMove, onOpen, onAdd, onChanged, onError }) {
  const [over, setOver] = useState(null);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmDel, setConfirmDel] = useState(null);
  const late = contacts
    .filter((c) => lateDays(c, stages) !== null)
    .sort((x, y) => y.days_in_stage - x.days_in_stage);

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
        <button className={editing ? '' : 'ghost'} onClick={() => { setEditing(!editing); setConfirmDel(null); onError(''); }}>
          {editing ? 'Concluir edição' : 'Editar etapas'}
        </button>
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
      {late.length > 0 && (
        <div className="alert" role="status">
          <strong>
            ⚠ {late.length} {late.length === 1 ? 'cliente precisa' : 'clientes precisam'} de atenção
          </strong>
          <span>
            {late.map((c, i) => (
              <button key={c.id} className="link" onClick={() => onOpen(c.id)}>
                {c.name || c.phone} ({stages.find((s) => s.key === c.stage)?.name}, {daysLabel(c.days_in_stage)})
                {i < late.length - 1 ? ',' : ''}
              </button>
            ))}
          </span>
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
                  className={`card ${lateDays(c, stages) !== null ? 'late' : ''}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
                  onClick={() => onOpen(c.id)}
                >
                  <strong>{c.name || c.phone}</strong>
                  {c.value_cents > 0 && <span className="value">{brl(c.value_cents)}</span>}
                  {lateDays(c, stages) !== null && <span className="late-tag">⚠ Parado {daysLabel(c.days_in_stage)}</span>}
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
