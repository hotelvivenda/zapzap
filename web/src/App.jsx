import { useEffect, useRef, useState } from 'react';

const LABELS = {
  novo: 'Novo',
  em_conversa: 'Em conversa',
  proposta: 'Proposta enviada',
  fechado: 'Fechado',
  perdido: 'Perdido',
};

async function api(path, opts) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Erro');
  return data;
}

export default function App() {
  const [config, setConfig] = useState({ provider: '', stages: [] });
  const [contacts, setContacts] = useState([]);
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [view, setView] = useState('conversas');
  const endRef = useRef(null);

  const selected = contacts.find((c) => c.id === selectedId);

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
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, stage } : c)));
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
      const c = await api('/contacts', { method: 'POST', body: { phone: form.phone, name: form.name } });
      setDialog(null);
      await loadContacts();
      setSelectedId(c.id);
    });

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
      </nav>
      {error && view === 'funil' && <div className="error">{error}</div>}
      {view === 'funil' ? (
        <Board contacts={contacts} stages={config.stages} onMove={moveStage} onOpen={openChat} />
      ) : (
    <div className="app">
      <aside className="list">
        <div className="search">
          <input placeholder="Buscar nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
          <button onClick={() => setDialog('new')}>+ Novo</button>
        </div>
        <ul>
          {contacts.map((c) => (
            <li key={c.id} className={c.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(c.id)}>
              <strong>{c.name || c.phone}</strong>
              <span className={`stage ${c.stage}`}>{LABELS[c.stage]}</span>
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
                {config.stages.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
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
          <label>Anotações</label>
          <textarea key={selected.id + 't'} defaultValue={selected.notes} onBlur={(e) => update({ notes: e.target.value })} />
        </aside>
      )}
    </div>
      )}
      {dialog && view === 'funil' && (
        <Dialog kind={dialog} error={error} onCancel={() => setDialog(null)} onSubmit={addContact} />
      )}
    </div>
  );
}

function Board({ contacts, stages, onMove, onOpen }) {
  const [over, setOver] = useState(null);
  const drop = (e, stage) => {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    const c = contacts.find((x) => x.id === id);
    if (c && c.stage !== stage) onMove(id, stage);
  };
  return (
    <div className="board">
      {stages.map((stage) => {
        const items = contacts.filter((c) => c.stage === stage);
        return (
          <section
            key={stage}
            className={`col ${over === stage ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
            onDragLeave={() => setOver((o) => (o === stage ? null : o))}
            onDrop={(e) => drop(e, stage)}
          >
            <h3>{LABELS[stage]} <span>{items.length}</span></h3>
            {items.map((c) => (
              <article
                key={c.id}
                className="card"
                draggable
                onDragStart={(e) => e.dataTransfer.setData('text/plain', String(c.id))}
                onClick={() => onOpen(c.id)}
              >
                <strong>{c.name || c.phone}</strong>
                <small>{c.last_body || 'Sem mensagens'}</small>
                <select
                  aria-label="Mover para etapa"
                  value={c.stage}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => onMove(c.id, e.target.value)}
                >
                  {stages.map((s) => <option key={s} value={s}>{LABELS[s]}</option>)}
                </select>
              </article>
            ))}
            {!items.length && <p className="empty">Arraste um cliente para cá</p>}
          </section>
        );
      })}
    </div>
  );
}

function Dialog({ kind, error, onCancel, onSubmit }) {
  const [form, setForm] = useState({ phone: '', name: '', text: '' });
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
