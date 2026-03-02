export async function hashPin(pin: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(pin);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sendTwilioMessage(
  accountSid: string,
  authToken: string,
  fromNumber: string,
  toNumber: string,
  body: string,
  messagingServiceSid?: string,
) {
  const toWhatsApp = toNumber.startsWith('whatsapp:') ? toNumber : `whatsapp:${toNumber}`;
  const basicAuth = btoa(`${accountSid}:${authToken}`);

  const send = async (params: Record<string, string>) => {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams(params).toString(),
      }
    );

    const data = await res.json();
    return { res, data };
  };

  const configuredMsgSvcSid = messagingServiceSid?.trim() || Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')?.trim();

  // Prefer Messaging Service to avoid sender/channel mismatches on WhatsApp.
  // If it fails, fallback to explicit From number when available.
  if (configuredMsgSvcSid) {
    const msgSvcParams: Record<string, string> = {
      To: toWhatsApp,
      Body: body,
      MessagingServiceSid: configuredMsgSvcSid,
    };
    console.log(`[TWILIO] Sending via MessagingServiceSid=${configuredMsgSvcSid} to=${toWhatsApp}`);
    const { res, data } = await send(msgSvcParams);

    if (!res.ok) {
      console.error('Twilio send error (MessagingServiceSid):', JSON.stringify(data));

      const fallbackFrom = fromNumber?.trim();
      if (fallbackFrom) {
        const fallbackFromWhatsApp = fallbackFrom.startsWith('whatsapp:') ? fallbackFrom : `whatsapp:${fallbackFrom}`;
        console.warn(`[TWILIO] MessagingServiceSid failed. Retrying with From=${fallbackFromWhatsApp} to=${toWhatsApp}`);

        const retryParams: Record<string, string> = {
          To: toWhatsApp,
          Body: body,
          From: fallbackFromWhatsApp,
        };

        const { res: retryRes, data: retryData } = await send(retryParams);
        if (!retryRes.ok) {
          console.error('Twilio retry send error (From fallback):', JSON.stringify(retryData));
        }
        return retryData;
      }
    }

    return data;
  }

  const fromWhatsApp = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
  const fromParams: Record<string, string> = {
    To: toWhatsApp,
    Body: body,
    From: fromWhatsApp,
  };

  console.log(`[TWILIO] Sending via From=${fromWhatsApp} to=${toWhatsApp}`);
  const { res: firstRes, data: firstData } = await send(fromParams);

  if (!firstRes.ok) {
    // Resilience fallback for Twilio 63007 sender-channel mismatch.
    if (firstData?.code === 63007) {
      const fallbackMsgSvcSid = Deno.env.get('TWILIO_MESSAGING_SERVICE_SID')?.trim();
      if (fallbackMsgSvcSid) {
        console.warn(`[TWILIO] 63007 with From. Retrying with MessagingServiceSid=${fallbackMsgSvcSid} to=${toWhatsApp}`);
        const retryParams: Record<string, string> = {
          To: toWhatsApp,
          Body: body,
          MessagingServiceSid: fallbackMsgSvcSid,
        };
        const { res: retryRes, data: retryData } = await send(retryParams);
        if (!retryRes.ok) {
          console.error('Twilio retry send error:', JSON.stringify(retryData));
        }
        return retryData;
      }
    }

    console.error('Twilio send error:', JSON.stringify(firstData));
  }

  return firstData;
}

export async function transcribeVoiceMessage(
  mediaUrl: string,
  mediaContentType: string | null,
  twilioAccountSid: string,
  twilioAuthToken: string,
  elevenlabsApiKey: string,
): Promise<string> {
  const basicAuth = btoa(`${twilioAccountSid}:${twilioAuthToken}`);
  const audioRes = await fetch(mediaUrl, {
    headers: { Authorization: `Basic ${basicAuth}` },
  });

  if (!audioRes.ok) {
    console.error('Failed to download audio:', audioRes.status);
    return '[No se pudo descargar el audio]';
  }

  const audioBuffer = await audioRes.arrayBuffer();
  const audioBlob = new Blob([audioBuffer], { type: mediaContentType || 'audio/ogg' });

  const formData = new FormData();
  formData.append('file', audioBlob, 'voice.ogg');
  formData.append('model_id', 'scribe_v2');
  formData.append('language_code', 'spa');
  formData.append('tag_audio_events', 'false');
  formData.append('diarize', 'false');

  const sttRes = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': elevenlabsApiKey },
    body: formData,
  });

  if (sttRes.ok) {
    const sttData = await sttRes.json();
    const transcribedText = sttData.text?.trim();
    if (transcribedText) {
      console.log(`Voice transcribed: "${transcribedText.substring(0, 100)}"`);
      return transcribedText;
    }
    console.log('STT returned empty text');
    return '[Mensaje de voz no reconocido]';
  }

  console.error('ElevenLabs STT error:', sttRes.status, await sttRes.text());
  return '[Error al transcribir mensaje de voz]';
}
