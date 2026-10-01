// API oficial do WhatsApp Business (Meta Cloud API).
const API = 'https://graph.facebook.com/v21.0';

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

// Extrai mensagens de texto recebidas do payload do webhook da Meta.
export function parseWebhook(body) {
  const out = [];
  for (const entry of body?.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const names = Object.fromEntries(
        (change.value?.contacts ?? []).map((c) => [c.wa_id, c.profile?.name])
      );
      for (const m of change.value?.messages ?? []) {
        if (m.type !== 'text') continue;
        out.push({ phone: m.from, name: names[m.from], text: m.text.body, id: m.id });
      }
    }
  }
  return out;
}
