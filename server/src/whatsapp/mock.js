// Provedor de teste: não envia nada de verdade.
export const mock = {
  name: 'mock',
  async send(phone, text) {
    console.log(`[mock] -> ${phone}: ${text}`);
    return { id: null };
  },
};
