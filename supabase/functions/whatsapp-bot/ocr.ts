import { AI_GATEWAY_URL } from "./constants.ts";

export async function processReceiptOCR(
  mediaUrl: string,
  twilioSid: string,
  twilioToken: string,
  apiKey: string,
  tenantId: string,
  context: Record<string, unknown>,
  supabase: any
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
            content: `Eres un sistema OCR especializado en extraer datos de comprobantes, tickets, facturas y recibos mexicanos.
Extrae EXACTAMENTE estos campos del comprobante en la imagen:
- monto: número decimal (solo el total final)
- descripcion: breve descripción del gasto
- fecha: fecha del comprobante en formato YYYY-MM-DD
- categoria: una de estas categorías: Comida, Transporte, Hospedaje, Material, Servicio, Combustible, Papelería, Otro
- rfc_emisor: RFC del emisor si es visible
- nombre_negocio: nombre del negocio/establecimiento

Responde SOLO con un JSON válido, sin markdown ni texto adicional.
Ejemplo: {"monto":350.00,"descripcion":"Comida en restaurante","fecha":"2026-02-28","categoria":"Comida","rfc_emisor":"ABC123456XYZ","nombre_negocio":"Restaurante El Buen Sazón"}`
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Extrae los datos de este comprobante de gasto:' },
              { type: 'image_url', image_url: { url: `data:${contentType};base64,${base64Image}` } },
            ],
          },
        ],
      }),
    });

    if (!ocrResponse.ok) {
      console.error('OCR AI error:', ocrResponse.status);
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
      return '❌ No pude interpretar el comprobante. Intenta con una foto más clara o registra manualmente:\n_Ej: "$350 comida con cliente"_';
    }

    const amount = Number(parsed.monto) || 0;
    if (amount <= 0) {
      return '❌ No pude detectar el monto en el comprobante. Intenta con una foto más clara.';
    }

    const description = parsed.descripcion || parsed.nombre_negocio || 'Gasto por comprobante';
    const expenseDate = parsed.fecha || new Date().toISOString().split('T')[0];
    const category = parsed.categoria || 'Otro';

    await supabase.from('expenses').insert({
      tenant_id: tenantId,
      user_id: context.user_id as string,
      amount,
      description,
      category,
      expense_date: expenseDate,
      status: 'pending',
      receipt_url: mediaUrl,
      ocr_data: parsed,
    });

    return `✅ *Gasto registrado por OCR:*\n\n• 💰 Monto: *$${amount.toFixed(2)} MXN*\n• 📝 Descripción: ${description}\n• 📂 Categoría: ${category}\n• 📅 Fecha: ${expenseDate}\n${parsed.nombre_negocio ? `• 🏪 Negocio: ${parsed.nombre_negocio}` : ''}\n${parsed.rfc_emisor ? `• 🔢 RFC: ${parsed.rfc_emisor}` : ''}\n\n¿Los datos son correctos? Si necesitas corregir algo, dímelo.`;
  } catch (err) {
    console.error('OCR processing error:', err);
    return '❌ Error al procesar el comprobante. Intenta de nuevo o registra manualmente:\n_Ej: "$350 comida con cliente"_';
  }
}
