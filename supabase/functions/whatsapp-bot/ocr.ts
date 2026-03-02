import { AI_GATEWAY_URL } from "./constants.ts";

export async function processReceiptOCR(
  mediaUrl: string,
  twilioSid: string,
  twilioToken: string,
  apiKey: string,
  tenantId: string,
  context: Record<string, unknown>,
  supabase: any,
  userMessage?: string
): Promise<string> {
  try {
    const basicAuth = btoa(`${twilioSid}:${twilioToken}`);
    const imgRes = await fetch(mediaUrl, {
      headers: { Authorization: `Basic ${basicAuth}` },
    });

    if (!imgRes.ok) {
      console.error('Failed to download image:', imgRes.status);
      return '❌ No pude descargar la imagen. Intenta enviarla de nuevo.';
    }

    const imgBuffer = await imgRes.arrayBuffer();
    const bytes = new Uint8Array(imgBuffer);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    const base64Image = btoa(binary);
    const contentType = imgRes.headers.get('content-type') || 'image/jpeg';

    const today = new Date().toISOString().split('T')[0];
    const userHint = userMessage ? `\nContexto adicional del usuario: "${userMessage}"` : '';

    const ocrResponse = await fetch(AI_GATEWAY_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: `Eres un sistema OCR inteligente que extrae gastos de imágenes. Puedes procesar:
- Comprobantes, tickets, facturas y recibos individuales
- Screenshots de estados de cuenta bancarios o apps bancarias con múltiples transacciones
- Listas de transacciones

REGLAS:
1. Si la imagen tiene UNA sola transacción/comprobante, devuelve un JSON con el objeto directamente.
2. Si la imagen tiene MÚLTIPLES transacciones, devuelve un JSON con un array "gastos".
3. Ignora transacciones que sean comisiones bancarias obvias (como "Intl. Transaction Fee", "Cargo por servicio bancario") a menos que el usuario las pida explícitamente.
4. Si no puedes determinar la fecha, usa "${today}".
5. Para montos en USD, convierte multiplicando por 20 y agrega "(USD)" a la descripción, o déjalos en USD si el usuario lo prefiere.

Campos por gasto:
- monto: número decimal positivo (valor absoluto, sin signo negativo)
- descripcion: descripción clara del gasto
- fecha: formato YYYY-MM-DD
- categoria: Comida | Transporte | Hospedaje | Material | Servicio | Software | Combustible | Papelería | Suscripción | Otro
- nombre_negocio: nombre del negocio si es visible
- moneda: "MXN" o "USD"

Formato de respuesta:
- Un gasto: {"monto":350,"descripcion":"Comida","fecha":"2026-03-01","categoria":"Comida","nombre_negocio":"Restaurante","moneda":"MXN"}
- Varios gastos: {"gastos":[{...},{...}]}

Responde SOLO con JSON válido, sin markdown ni texto adicional.`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Extrae los gastos de esta imagen.${userHint}` },
              { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64Image}` } },
            ],
          },
        ],
      }),
    });

    if (!ocrResponse.ok) {
      console.error('OCR AI error:', ocrResponse.status, await ocrResponse.text());
      return '❌ Error al procesar la imagen con IA. Intenta de nuevo o registra el gasto manualmente.';
    }

    const ocrResult = await ocrResponse.json();
    const rawText = ocrResult.choices?.[0]?.message?.content || '';

    let cleaned = rawText.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    }

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      console.error('OCR parse error, raw:', rawText);
      return '❌ No pude interpretar la imagen. Intenta con una foto más clara o registra manualmente:\n_Ej: "$350 comida con cliente"_';
    }

    // Normalize to array
    const expenses: any[] = parsed.gastos ? parsed.gastos : [parsed];
    const validExpenses = expenses.filter(e => Number(e.monto) > 0);

    if (validExpenses.length === 0) {
      console.error('No valid expenses found, parsed:', JSON.stringify(parsed));
      return '❌ No pude detectar montos en la imagen. Intenta con una foto más clara o registra manualmente:\n_Ej: "$350 comida con cliente"_';
    }

    // Insert all expenses
    const rows = validExpenses.map(e => ({
      tenant_id: tenantId,
      user_id: context.user_id as string,
      amount: Number(e.monto),
      description: e.descripcion || e.nombre_negocio || 'Gasto por comprobante',
      category: e.categoria || 'Otro',
      expense_date: e.fecha || today,
      currency: e.moneda || 'MXN',
      status: 'pending',
      receipt_url: mediaUrl,
      ocr_data: e,
    }));

    const { error: insertError } = await supabase.from('expenses').insert(rows);

    if (insertError) {
      console.error('OCR expense insert error:', insertError);
      return `❌ Detecté ${validExpenses.length} gasto(s) en la imagen pero no pude guardarlos en la base de datos. Intenta de nuevo.\n\n_Escribe *menu* para volver al inicio._`;
    }

    // Format reply
    if (validExpenses.length === 1) {
      const e = validExpenses[0];
      const amount = Number(e.monto);
      const currency = e.moneda || 'MXN';
      return `✅ *Gasto registrado:*\n\n• 💰 Monto: *$${amount.toFixed(2)} ${currency}*\n• 📝 ${e.descripcion || e.nombre_negocio || 'Gasto'}\n• 📂 ${e.categoria || 'Otro'}\n• 📅 ${e.fecha || today}\n${e.nombre_negocio ? `• 🏪 ${e.nombre_negocio}` : ''}\n\n¿Los datos son correctos?`;
    }

    const totalByCurrency: Record<string, number> = {};
    const lines = validExpenses.map((e, i) => {
      const amt = Number(e.monto);
      const cur = e.moneda || 'MXN';
      totalByCurrency[cur] = (totalByCurrency[cur] || 0) + amt;
      return `${i + 1}. $${amt.toFixed(2)} ${cur} — ${e.descripcion || e.nombre_negocio || 'Gasto'}`;
    });

    const totals = Object.entries(totalByCurrency).map(([cur, total]) => `$${total.toFixed(2)} ${cur}`).join(' + ');

    return `✅ *${validExpenses.length} gastos registrados:*\n\n${lines.join('\n')}\n\n💰 *Total: ${totals}*\n\n¿Todo correcto? Si necesitas corregir algo, dímelo.`;
  } catch (err) {
    console.error('OCR processing error:', err);
    return '❌ Error al procesar la imagen. Intenta de nuevo o registra manualmente:\n_Ej: "$350 comida con cliente"_';
  }
}
