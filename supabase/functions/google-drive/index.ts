/**
 * Google Drive Edge Function
 * 
 * Actions:
 * - setup_folder: Create root folder + subfolders for a tenant
 * - upload_file: Upload a file to a specific subfolder
 * - get_status: Check if tenant has Drive configured
 * - refresh_token: Internal helper to refresh OAuth token
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.98.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('VITE_SUPABASE_URL');
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY');
  const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')!;
  const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET')!;

  try {
    const body = await req.json();
    const { action } = body;

    const authHeader = req.headers.get('Authorization') || '';
    const bearerToken = authHeader.replace('Bearer ', '').trim();

    if (!SUPABASE_URL) {
      console.error('[google-drive] Missing SUPABASE_URL');
      return jsonResponse({ error: 'Server misconfigured: SUPABASE_URL missing' }, 500);
    }

    const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
    if (!supabaseKey) {
      console.error('[google-drive] Missing Supabase API key (service/anon)');
      return jsonResponse({ error: 'Server misconfigured: Supabase key missing' }, 500);
    }

    const supabase = createClient(SUPABASE_URL, supabaseKey, {
      global: bearerToken
        ? { headers: { Authorization: `Bearer ${bearerToken}` } }
        : undefined,
    });

    // ─── AUTH: Validate caller ───
    // For internal calls (from backend workers), accept service_role token
    // For UI calls, validate JWT
    let callerUserId: string | null = null;

    if (!bearerToken) {
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    const { data: userData, error: userErr } = await supabase.auth.getUser(bearerToken);
    if (userData?.user?.id) {
      callerUserId = userData.user.id;
    } else if (
      body.internal_caller === true
      && await isValidInternalAuth(SUPABASE_URL, bearerToken, SUPABASE_SERVICE_ROLE_KEY)
    ) {
      callerUserId = body.user_id || null;
      console.log('[google-drive] Internal service auth, user:', callerUserId);
    } else {
      console.error('[google-drive] Auth failed:', userErr?.message || 'invalid token');
      return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    console.log(`[google-drive] action=${action} tenant=${body.tenant_id || 'n/a'} internal=${body.internal_caller === true}`);

    const tenantId = body.tenant_id;
    if (!tenantId) {
      return jsonResponse({ error: 'tenant_id required' }, 400);
    }

    // ─── GET STATUS ───
    if (action === 'get_status') {
      const { data: settings } = await supabase
        .from('tenant_drive_settings')
        .select('*')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      return jsonResponse({
        configured: !!settings,
        drive_root_folder_id: settings?.drive_root_folder_id || null,
        drive_root_folder_url: settings?.drive_root_folder_url || null,
        drive_budgets_folder_id: settings?.drive_budgets_folder_id || null,
        drive_receipts_folder_id: settings?.drive_receipts_folder_id || null,
      });
    }

    // ─── SETUP FOLDER ───
    if (action === 'setup_folder') {
      // Only owner/admin/super_admin can set up folders
      if (callerUserId) {
        const isAuthorized = await checkAdminRole(supabase, callerUserId, tenantId);
        if (!isAuthorized) {
          return jsonResponse({ error: 'Solo administradores pueden configurar Google Drive' }, 403);
        }
      }

      // Get OAuth token for this tenant (from the admin who connected)
      const accessToken = await getValidAccessToken(supabase, tenantId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      if (!accessToken) {
        return jsonResponse({ error: 'No hay cuenta de Google conectada. Conecta Google Calendar primero.' }, 400);
      }

      // Get tenant name
      const { data: tenant } = await supabase
        .from('tenants')
        .select('name')
        .eq('id', tenantId)
        .single();
      const tenantName = tenant?.name || 'Empresa';

      // Check if already configured
      const { data: existing } = await supabase
        .from('tenant_drive_settings')
        .select('drive_root_folder_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (existing?.drive_root_folder_id) {
        // Verify folder still exists
        const checkRes = await fetch(`${DRIVE_API}/files/${existing.drive_root_folder_id}?fields=id,name,trashed`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (checkRes.ok) {
          const folderData = await checkRes.json();
          if (!folderData.trashed) {
            return jsonResponse({
              success: true,
              already_configured: true,
              drive_root_folder_id: existing.drive_root_folder_id,
            });
          }
        }
      }

      // Create root folder: "Aria - {TenantName} - Finanzas"
      const rootFolderResult = await createFolder(accessToken, `Aria - ${tenantName} - Finanzas`, null);
      if (rootFolderResult.error === 'insufficient_scope') {
        // Token was obtained before Drive scope was added — user must re-authorize
        // Invalidate current token so re-auth is triggered
        await supabase
          .from('google_calendar_tokens')
          .update({ status: 'requires_reauth', updated_at: new Date().toISOString() })
          .eq('tenant_id', tenantId)
          .eq('status', 'active');

        return jsonResponse({
          error: 'scope_missing',
          message: 'Tu cuenta de Google necesita permisos adicionales para Google Drive. Ve a Configuración → Google Calendar y reconecta tu cuenta.',
          action: 'reauth_required',
        }, 403);
      }
      if (!rootFolderResult.id) {
        return jsonResponse({ error: 'No se pudo crear la carpeta en Google Drive. Verifica los permisos.' }, 500);
      }
      const rootFolderId = rootFolderResult.id;

      // Create subfolders
      const budgetsResult = await createFolder(accessToken, 'Presupuestos', rootFolderId);
      const receiptsResult = await createFolder(accessToken, 'Comprobantes', rootFolderId);
      const budgetsFolderId = budgetsResult.id;
      const receiptsFolderId = receiptsResult.id;

      const rootUrl = `https://drive.google.com/drive/folders/${rootFolderId}`;

      // Save settings
      await supabase.from('tenant_drive_settings').upsert({
        tenant_id: tenantId,
        drive_root_folder_id: rootFolderId,
        drive_root_folder_url: rootUrl,
        drive_budgets_folder_id: budgetsFolderId,
        drive_receipts_folder_id: receiptsFolderId,
        drive_structure_version: 1,
        drive_provider: 'google',
        created_by: callerUserId,
        updated_by: callerUserId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'tenant_id' });

      // Audit log
      await supabase.from('drive_audit_log').insert({
        tenant_id: tenantId,
        user_id: callerUserId,
        action: 'folder_created',
        resource_type: 'folder',
        resource_id: rootFolderId,
        resource_name: `Aria - ${tenantName} - Finanzas`,
        metadata: { budgets_folder: budgetsFolderId, receipts_folder: receiptsFolderId },
      });

      return jsonResponse({
        success: true,
        drive_root_folder_id: rootFolderId,
        drive_root_folder_url: rootUrl,
        drive_budgets_folder_id: budgetsFolderId,
        drive_receipts_folder_id: receiptsFolderId,
      });
    }

    // ─── UPLOAD FILE ───
    if (action === 'upload_file') {
      const { file_url, file_name, folder_type, expense_id, twilio_sid, twilio_token } = body;

      if (!file_url) {
        return jsonResponse({ error: 'file_url required' }, 400);
      }

      const accessToken = await getValidAccessToken(supabase, tenantId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      if (!accessToken) {
        return jsonResponse({ error: 'No se pudo obtener acceso a Google Drive.' }, 500);
      }

      // Get Drive settings — verify and auto-recreate folders if deleted
      const driveSettings = await ensureDriveFolders(supabase, tenantId, accessToken, callerUserId);
      if (!driveSettings) {
        return jsonResponse({ error: 'drive_not_configured', message: 'Google Drive no está configurado. Ve a Configuración para conectarlo.' }, 400);
      }

      // Determine target folder
      const parentFolderId = folder_type === 'budget'
        ? driveSettings.drive_budgets_folder_id
        : driveSettings.drive_receipts_folder_id;

      if (!parentFolderId) {
        return jsonResponse({ error: 'Carpeta de destino no encontrada en Drive.' }, 500);
      }

      // Download the file (from Twilio or direct URL)
      let fileBuffer: ArrayBuffer;
      let contentType = 'image/jpeg';
      try {
        const fetchHeaders: Record<string, string> = {};
        if (twilio_sid && twilio_token) {
          fetchHeaders['Authorization'] = `Basic ${btoa(`${twilio_sid}:${twilio_token}`)}`;
        }
        const fileRes = await fetch(file_url, { headers: fetchHeaders });
        if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
        contentType = fileRes.headers.get('content-type') || 'image/jpeg';
        fileBuffer = await fileRes.arrayBuffer();
      } catch (e) {
        console.error('File download error:', e);
        return jsonResponse({ error: 'No se pudo descargar el archivo.' }, 500);
      }

      // Generate filename with date
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toISOString().split('T')[1].replace(/[:.]/g, '').slice(0, 6);
      const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
      const finalName = file_name || `${folder_type === 'budget' ? 'presupuesto' : 'comprobante'}_${dateStr}_${timeStr}.${ext}`;

      // Upload to Drive
      const metadata = {
        name: finalName,
        parents: [parentFolderId],
      };

      const boundary = 'boundary_' + Date.now();
      const metadataStr = JSON.stringify(metadata);

      // Build multipart body
      const encoder = new TextEncoder();
      const metaPart = encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n`
      );
      const filePart = encoder.encode(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
      const endPart = encoder.encode(`\r\n--${boundary}--`);
      const fileBytes = new Uint8Array(fileBuffer);

      const totalLength = metaPart.length + filePart.length + fileBytes.length + endPart.length;
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      combined.set(metaPart, offset); offset += metaPart.length;
      combined.set(filePart, offset); offset += filePart.length;
      combined.set(fileBytes, offset); offset += fileBytes.length;
      combined.set(endPart, offset);

      const uploadRes = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: combined,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error('Drive upload error:', uploadRes.status, errText);
        return jsonResponse({ error: 'No se pudo subir el archivo a Google Drive.' }, 500);
      }

      const uploadData = await uploadRes.json();
      const driveFileId = uploadData.id;
      const driveFileUrl = uploadData.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`;

      // Update expense record if expense_id provided
      if (expense_id) {
        const updateFields: Record<string, any> = {
          drive_folder_id: driveSettings.drive_root_folder_id,
        };
        if (folder_type === 'budget') {
          updateFields.document_budget_drive_file_id = driveFileId;
          updateFields.document_budget_drive_url = driveFileUrl;
        } else {
          updateFields.document_payment_drive_file_id = driveFileId;
          updateFields.document_payment_drive_url = driveFileUrl;
        }
        await supabase.from('expenses').update(updateFields).eq('id', expense_id);
      }

      // Audit log
      await supabase.from('drive_audit_log').insert({
        tenant_id: tenantId,
        user_id: callerUserId,
        action: 'file_uploaded',
        resource_type: 'file',
        resource_id: driveFileId,
        resource_name: finalName,
        metadata: { folder_type, expense_id, content_type: contentType },
      });

      return jsonResponse({
        success: true,
        drive_file_id: driveFileId,
        drive_file_url: driveFileUrl,
      });
    }

    // ─── ENSURE SUBFOLDER ───
    if (action === 'ensure_subfolder') {
      const { folder_name, parent_folder_name } = body;
      if (!folder_name) return jsonResponse({ error: 'folder_name required' }, 400);

      const accessToken = await getValidAccessToken(supabase, tenantId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      if (!accessToken) return jsonResponse({ error: 'No Google access token' }, 400);

      const driveSettings = await ensureDriveFolders(supabase, tenantId, accessToken, callerUserId);
      if (!driveSettings?.drive_root_folder_id) {
        return jsonResponse({ error: 'Drive not configured' }, 400);
      }

      let parentId = driveSettings.drive_root_folder_id;

      // If parent_folder_name specified, find or create it first
      if (parent_folder_name) {
        const parentSearch = await searchFolderByName(accessToken, parent_folder_name, driveSettings.drive_root_folder_id);
        if (parentSearch) {
          parentId = parentSearch;
        } else {
          const newParent = await createFolder(accessToken, parent_folder_name, driveSettings.drive_root_folder_id);
          if (newParent.id) parentId = newParent.id;
        }
      }

      // Check if subfolder already exists
      const existingId = await searchFolderByName(accessToken, folder_name, parentId);
      if (existingId) {
        return jsonResponse({ folder_id: existingId, already_exists: true });
      }

      // Create it
      const result = await createFolder(accessToken, folder_name, parentId);
      if (!result.id) return jsonResponse({ error: 'Could not create folder' }, 500);

      await supabase.from('drive_audit_log').insert({
        tenant_id: tenantId, user_id: callerUserId,
        action: 'subfolder_created', resource_type: 'folder',
        resource_id: result.id, resource_name: folder_name,
        metadata: { parent_id: parentId },
      });

      return jsonResponse({ folder_id: result.id, created: true });
    }

    // ─── UPLOAD FILE TO SPECIFIC FOLDER ───
    if (action === 'upload_file_to_folder') {
      const { file_url, file_name, target_folder_id, document_id, twilio_sid, twilio_token } = body;
      if (!file_url) return jsonResponse({ error: 'file_url required' }, 400);

      const accessToken = await getValidAccessToken(supabase, tenantId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      if (!accessToken) return jsonResponse({ error: 'No access token' }, 500);

      const driveSettings = await ensureDriveFolders(supabase, tenantId, accessToken, callerUserId);
      if (!driveSettings) return jsonResponse({ error: 'Drive not configured' }, 400);

      let parentFolderId = target_folder_id || driveSettings.drive_root_folder_id;

      // If a specific folder was provided but no longer exists, fallback to root
      if (target_folder_id) {
        const folderCheckRes = await fetch(`${DRIVE_API}/files/${target_folder_id}?fields=id,trashed`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (folderCheckRes.ok) {
          const folderData = await folderCheckRes.json();
          if (folderData?.trashed) {
            parentFolderId = driveSettings.drive_root_folder_id;
          }
        } else {
          await folderCheckRes.text();
          parentFolderId = driveSettings.drive_root_folder_id;
        }
      }

      // Download file
      let fileBuffer: ArrayBuffer;
      let contentType = 'application/octet-stream';
      try {
        const fetchHeaders: Record<string, string> = {};
        if (twilio_sid && twilio_token) {
          fetchHeaders['Authorization'] = `Basic ${btoa(`${twilio_sid}:${twilio_token}`)}`;
        }
        const fileRes = await fetch(file_url, { headers: fetchHeaders });
        if (!fileRes.ok) throw new Error(`Download failed: ${fileRes.status}`);
        contentType = fileRes.headers.get('content-type') || 'application/octet-stream';
        fileBuffer = await fileRes.arrayBuffer();
      } catch (e) {
        console.error('File download error:', e);
        return jsonResponse({ error: 'Could not download file' }, 500);
      }

      const finalName = file_name || `document_${Date.now()}.${contentType.split('/').pop() || 'bin'}`;

      // Upload via multipart
      const metadata = { name: finalName, parents: [parentFolderId] };
      const boundary = 'boundary_' + Date.now();
      const metadataStr = JSON.stringify(metadata);
      const encoder = new TextEncoder();
      const metaPart = encoder.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n`);
      const filePart = encoder.encode(`--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`);
      const endPart = encoder.encode(`\r\n--${boundary}--`);
      const fileBytes = new Uint8Array(fileBuffer);
      const totalLength = metaPart.length + filePart.length + fileBytes.length + endPart.length;
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      combined.set(metaPart, offset); offset += metaPart.length;
      combined.set(filePart, offset); offset += filePart.length;
      combined.set(fileBytes, offset); offset += fileBytes.length;
      combined.set(endPart, offset);

      const uploadRes = await fetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id,webViewLink`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
        body: combined,
      });

      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error('Drive upload error:', uploadRes.status, errText);
        return jsonResponse({ error: 'Upload failed' }, 500);
      }

      const uploadData = await uploadRes.json();
      const driveFileId = uploadData.id;
      const driveFileUrl = uploadData.webViewLink || `https://drive.google.com/file/d/${driveFileId}/view`;

      // Update document record if provided
      if (document_id) {
        await supabase.from('documents').update({
          google_drive_file_id: driveFileId,
          google_drive_folder_id: parentFolderId,
          google_drive_url: driveFileUrl,
          upload_status: 'uploaded',
        }).eq('id', document_id);
      }

      await supabase.from('drive_audit_log').insert({
        tenant_id: tenantId, user_id: callerUserId,
        action: 'file_uploaded', resource_type: 'file',
        resource_id: driveFileId, resource_name: finalName,
        metadata: { folder_id: parentFolderId, document_id, content_type: contentType },
      });

      return jsonResponse({ success: true, drive_file_id: driveFileId, drive_file_url: driveFileUrl });
    }

    // ─── LIST FOLDERS ───
    if (action === 'list_folders') {
      const { data: driveSettings } = await supabase
        .from('tenant_drive_settings')
        .select('drive_root_folder_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!driveSettings?.drive_root_folder_id) return jsonResponse({ folders: [], error: 'Drive not configured' });

      const accessToken = await getValidAccessToken(supabase, tenantId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      if (!accessToken) return jsonResponse({ error: 'No access token' }, 400);

      const query = `'${driveSettings.drive_root_folder_id}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
      const listRes = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id,name,createdTime)&orderBy=name`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!listRes.ok) return jsonResponse({ error: 'Could not list folders' }, 500);
      const listData = await listRes.json();

      return jsonResponse({
        folders: (listData.files || []).map((f: any) => ({
          id: f.id,
          name: f.name,
          created: f.createdTime,
        })),
      });
    }

    // ─── SEARCH FOLDER ───
    if (action === 'search_folder') {
      const { folder_name: searchName } = body;
      if (!searchName) return jsonResponse({ error: 'folder_name required' }, 400);

      const { data: driveSettings } = await supabase
        .from('tenant_drive_settings')
        .select('drive_root_folder_id')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (!driveSettings?.drive_root_folder_id) return jsonResponse({ folders: [] });

      const accessToken = await getValidAccessToken(supabase, tenantId, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
      if (!accessToken) return jsonResponse({ error: 'No access token' }, 400);

      const folderId = await searchFolderByName(accessToken, searchName, driveSettings.drive_root_folder_id);
      return jsonResponse({
        found: !!folderId,
        folder_id: folderId,
        folder_name: searchName,
      });
    }

    return jsonResponse({ error: 'Unknown action' }, 400);
  } catch (err) {
    console.error('Google Drive function error:', err);
    return jsonResponse({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});

// ==================== AUTO-RECOVERY ====================

async function ensureDriveFolders(
  supabase: any,
  tenantId: string,
  accessToken: string,
  callerUserId: string | null,
): Promise<{ drive_root_folder_id: string; drive_budgets_folder_id: string; drive_receipts_folder_id: string } | null> {
  const checkFolderExists = async (folderId: string | null | undefined): Promise<boolean> => {
    if (!folderId) return false;
    try {
      const res = await fetch(`${DRIVE_API}/files/${folderId}?fields=id,trashed`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        await res.text();
        return false;
      }
      const data = await res.json();
      return !data?.trashed;
    } catch {
      return false;
    }
  };

  const { data: tenant } = await supabase.from('tenants').select('name').eq('id', tenantId).single();
  const tenantName = tenant?.name || 'Empresa';

  const createOrRecreateStructure = async (oldRootId: string | null = null) => {
    const rootResult = await createFolder(accessToken, `Aria - ${tenantName} - Finanzas`, null);
    if (!rootResult.id) return null;

    const budgetsResult = await createFolder(accessToken, 'Presupuestos', rootResult.id);
    const receiptsResult = await createFolder(accessToken, 'Comprobantes', rootResult.id);
    await createFolder(accessToken, 'Proyectos', rootResult.id);

    if (!budgetsResult.id || !receiptsResult.id) return null;

    const rootUrl = `https://drive.google.com/drive/folders/${rootResult.id}`;

    await supabase.from('tenant_drive_settings').upsert({
      tenant_id: tenantId,
      drive_root_folder_id: rootResult.id,
      drive_root_folder_url: rootUrl,
      drive_budgets_folder_id: budgetsResult.id,
      drive_receipts_folder_id: receiptsResult.id,
      drive_structure_version: 1,
      drive_provider: 'google',
      created_by: callerUserId,
      updated_by: callerUserId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'tenant_id' });

    await supabase.from('drive_audit_log').insert({
      tenant_id: tenantId,
      user_id: callerUserId,
      action: oldRootId ? 'folder_recreated' : 'folder_created',
      resource_type: 'folder',
      resource_id: rootResult.id,
      resource_name: `Aria - ${tenantName} - Finanzas`,
      metadata: oldRootId ? { reason: 'root_folder_deleted', old_folder_id: oldRootId } : { auto_provisioned: true },
    });

    return {
      drive_root_folder_id: rootResult.id,
      drive_budgets_folder_id: budgetsResult.id,
      drive_receipts_folder_id: receiptsResult.id,
    };
  };

  const { data: settings } = await supabase
    .from('tenant_drive_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  // No settings yet: auto-provision immediately
  if (!settings?.drive_root_folder_id) {
    return await createOrRecreateStructure(null);
  }

  const rootExists = await checkFolderExists(settings.drive_root_folder_id);
  if (!rootExists) {
    return await createOrRecreateStructure(settings.drive_root_folder_id);
  }

  // Root exists: ensure required subfolders are still valid
  let budgetsId = settings.drive_budgets_folder_id;
  let receiptsId = settings.drive_receipts_folder_id;

  if (!(await checkFolderExists(budgetsId))) {
    const created = await createFolder(accessToken, 'Presupuestos', settings.drive_root_folder_id);
    budgetsId = created.id;
  }

  if (!(await checkFolderExists(receiptsId))) {
    const created = await createFolder(accessToken, 'Comprobantes', settings.drive_root_folder_id);
    receiptsId = created.id;
  }

  if (!budgetsId || !receiptsId) return null;

  if (budgetsId !== settings.drive_budgets_folder_id || receiptsId !== settings.drive_receipts_folder_id) {
    await supabase.from('tenant_drive_settings').update({
      drive_budgets_folder_id: budgetsId,
      drive_receipts_folder_id: receiptsId,
      updated_by: callerUserId,
      updated_at: new Date().toISOString(),
    }).eq('tenant_id', tenantId);
  }

  return {
    drive_root_folder_id: settings.drive_root_folder_id,
    drive_budgets_folder_id: budgetsId,
    drive_receipts_folder_id: receiptsId,
  };
}



async function getValidAccessToken(
  supabase: any,
  tenantId: string,
  clientId: string,
  clientSecret: string,
): Promise<string | null> {
  // Find the most recent active token for this tenant (from any admin who connected)
  const { data: tokenRow } = await supabase
    .from('google_calendar_tokens')
    .select('id, user_id, access_token, refresh_token, token_expires_at')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!tokenRow) return null;

  // Check if token is expired (5 min buffer)
  const expiresAt = new Date(tokenRow.token_expires_at).getTime();
  if (Date.now() < expiresAt - 300_000) {
    return tokenRow.access_token;
  }

  // Refresh token
  if (!tokenRow.refresh_token) return null;

  const refreshRes = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: tokenRow.refresh_token,
      grant_type: 'refresh_token',
    }),
  });

  const refreshData = await refreshRes.json();
  if (!refreshRes.ok || !refreshData.access_token) {
    console.error('Token refresh failed:', JSON.stringify(refreshData));
    return null;
  }

  // Update token in DB
  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 3600) * 1000).toISOString();
  await supabase.from('google_calendar_tokens').update({
    access_token: refreshData.access_token,
    token_expires_at: newExpiresAt,
    updated_at: new Date().toISOString(),
  }).eq('id', tokenRow.id);

  return refreshData.access_token;
}

async function createFolder(accessToken: string, name: string, parentId: string | null): Promise<{ id: string | null; error?: string }> {
  const metadata: any = {
    name,
    mimeType: 'application/vnd.google-apps.folder',
  };
  if (parentId) {
    metadata.parents = [parentId];
  }

  const res = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(metadata),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error('Create folder error:', res.status, errText);
    if (res.status === 403 && errText.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT')) {
      return { id: null, error: 'insufficient_scope' };
    }
    return { id: null };
  }

  const data = await res.json();
  return { id: data.id };
}

async function searchFolderByName(accessToken: string, name: string, parentId: string): Promise<string | null> {
  const query = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const res = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(query)}&fields=files(id)&pageSize=1`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.files?.[0]?.id || null;
}

async function checkAdminRole(supabase: any, userId: string, tenantId: string): Promise<boolean> {
  const { data } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('tenant_id', tenantId)
    .in('role', ['super_admin', 'owner', 'admin'])
    .maybeSingle();
  return !!data;
}

function isServiceRoleJwt(token: string): boolean {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1]));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
