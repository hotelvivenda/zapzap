// API oficial do WhatsApp Business (Meta Cloud API).
const API = process.env.WHATSAPP_API_BASE || 'https://graph.facebook.com/v21.0';

export const cloud = {
  name: 'cloud',
  async send(phone, text) {
    const { WHATSAPP_TOKEN: token, WHATSAPP_PHONE_NUMBER_ID: id } = process.env;
    if (!token || !id) throw new Error('Configure WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID');
    const res = await fetch(`${API}/${id}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: phone,
        type: 'text',
        text: { body: text },
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error?.message || 'Falha ao enviar pelo WhatsApp');
    return { id: data.messages?.[0]?.id ?? null };
  },
};

const MEDIA = ['image', 'audio', 'video', 'document', 'sticker'];

// Baixa o arquivo de uma mensagem (a Meta só guarda por pouco tempo, então é baixado na hora).
export async function downloadMedia(mediaId, maxBytes) {
  const auth = { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` };
  const info = await fetch(`${API}/${mediaId}`, { headers: auth, signal: AbortSignal.timeout(20000) });
  const meta = await info.json();
  if (!info.ok || !meta.url) throw new Error(meta?.error?.message || 'Arquivo indisponível');
  if (meta.file_size > maxBytes) throw new Error('Arquivo grande demais');
  const res = await fetch(meta.url, { headers: auth, signal: AbortSignal.timeout(90000) });
  if (!res.ok) throw new Error(`Falha ao baixar (${res.status})`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length > maxBytes) throw new Error('Arquivo grande demais');
  return { buffer, mime: meta.mime_type || res.headers.get('content-type') };
}

// Transforma o payload do webhook da Meta em itens simples: texto, mídia ou tipo não suportado.
export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const names = Object.fromEntries((change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name]));
      for (const m of change.value?.messages ?? []) {
        const base = { phone: m.from, name: names[m.from], id: m.id };
        if (m.type === 'text') out.push({ ...base, text: m.text?.body ?? '' });
        else if (MEDIA.includes(m.type)) {
          const x = m[m.type] ?? {};
          out.push({ ...base, text: x.caption ?? '', media: { type: m.type, id: x.id, mime: x.mime_type, filename: x.filename } });
        } else if (m.type === 'button') out.push({ ...base, text: m.button?.text ?? '' });
        else if (m.type === 'interactive')
          out.push({ ...base, text: m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '' });
        else if (m.type === 'reaction') continue; // reação (curtida) não é uma mensagem
        else out.push({ ...base, text: `[Mensagem do tipo "${m.type}", que o CRM ainda não mostra. Veja no WhatsApp.]` });
      }
    }
  }
  return out;
}
