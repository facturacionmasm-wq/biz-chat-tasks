import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import {
  Upload, FileText, File, Image, Trash2, ExternalLink, Download,
  Loader2, FileSpreadsheet, FileArchive, FileVideo, FileAudio, Search
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ProjectDocument {
  id: string;
  file_name: string;
  file_size: number | null;
  mime_type: string | null;
  storage_path: string | null;
  drive_file_id: string | null;
  drive_file_url: string | null;
  description: string | null;
  created_at: string;
  uploaded_by: string;
}

const fileIcon = (mime: string | null) => {
  if (!mime) return File;
  if (mime.startsWith('image/')) return Image;
  if (mime.includes('pdf')) return FileText;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return FileSpreadsheet;
  if (mime.includes('video')) return FileVideo;
  if (mime.includes('audio')) return FileAudio;
  if (mime.includes('zip') || mime.includes('rar') || mime.includes('tar')) return FileArchive;
  return File;
};

const formatSize = (bytes: number | null) => {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

interface Props {
  projectId: string;
  projectName: string;
  tenantId: string;
}

export default function ProjectDocuments({ projectId, projectName, tenantId }: Props) {
  const { user } = useAuth();
  const [docs, setDocs] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocs = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', projectId)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error loading project docs:', error);
    } else {
      setDocs(data || []);
    }
    setLoading(false);
  }, [projectId, tenantId]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !user) return;

    setUploading(true);
    let successCount = 0;

    for (const file of Array.from(files)) {
      const filePath = `${tenantId}/${projectId}/${Date.now()}_${file.name}`;

      // Upload to storage
      const { error: storageError } = await supabase.storage
        .from('project-documents')
        .upload(filePath, file, { contentType: file.type });

      if (storageError) {
        console.error('Storage upload error:', storageError);
        toast.error(`Error subiendo ${file.name}`);
        continue;
      }

      // Save record
      const { error: dbError } = await supabase
        .from('project_documents')
        .insert({
          tenant_id: tenantId,
          project_id: projectId,
          uploaded_by: user.id,
          file_name: file.name,
          file_size: file.size,
          mime_type: file.type,
          storage_path: filePath,
        });

      if (dbError) {
        console.error('DB insert error:', dbError);
        toast.error(`Error registrando ${file.name}`);
        continue;
      }

      // Try uploading to Google Drive (fire-and-forget)
      try {
        const { publicUrl } = supabase.storage.from('project-documents').getPublicUrl(filePath).data;
        supabase.functions.invoke('google-drive', {
          body: {
            action: 'upload_project_document',
            tenant_id: tenantId,
            project_id: projectId,
            project_name: projectName,
            file_url: publicUrl,
            file_name: file.name,
          },
        }).then(async (res) => {
          if (res.data?.drive_file_id) {
            // Update record with drive info
            await supabase
              .from('project_documents')
              .update({
                drive_file_id: res.data.drive_file_id,
                drive_file_url: res.data.drive_file_url,
              })
              .eq('storage_path', filePath)
              .eq('tenant_id', tenantId);
            loadDocs();
          }
        }).catch(() => {});
      } catch {}

      successCount++;
    }

    if (successCount > 0) {
      toast.success(`${successCount} archivo(s) subido(s) ✅`);
      loadDocs();
    }

    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDelete = async (doc: ProjectDocument) => {
    if (!confirm(`¿Eliminar "${doc.file_name}"?`)) return;

    if (doc.storage_path) {
      await supabase.storage.from('project-documents').remove([doc.storage_path]);
    }

    const { error } = await supabase
      .from('project_documents')
      .delete()
      .eq('id', doc.id);

    if (error) {
      toast.error('Error eliminando documento');
      return;
    }
    setDocs(prev => prev.filter(d => d.id !== doc.id));
    toast.success('Documento eliminado');
  };

  const getDownloadUrl = (doc: ProjectDocument) => {
    if (doc.storage_path) {
      return supabase.storage.from('project-documents').getPublicUrl(doc.storage_path).data.publicUrl;
    }
    return doc.drive_file_url || '#';
  };

  const filtered = docs.filter(d =>
    d.file_name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="animate-spin text-primary" size={24} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder="Buscar documento..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm bg-muted/50 border border-border rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 text-foreground placeholder:text-muted-foreground"
          />
        </div>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleUpload}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2.5 rounded-xl hover:opacity-90 shadow-soft active:scale-95 transition-all disabled:opacity-50"
          >
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? 'Subiendo...' : 'Subir Documentos'}
          </button>
        </div>
      </div>

      {/* Documents grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText size={40} className="text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground mb-3">
            {search ? 'No se encontraron documentos' : 'Este proyecto aún no tiene documentos'}
          </p>
          {!search && (
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90"
            >
              <Upload size={16} /> Subir primer documento
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(doc => {
            const Icon = fileIcon(doc.mime_type);
            return (
              <div key={doc.id} className="bg-card border border-border rounded-2xl p-4 hover:shadow-soft transition-all group">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Icon size={20} className="text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground truncate" title={doc.file_name}>
                      {doc.file_name}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                      <span>{formatSize(doc.file_size)}</span>
                      <span>•</span>
                      <span>{format(new Date(doc.created_at), "d MMM yyyy", { locale: es })}</span>
                    </div>
                    {doc.drive_file_url && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-primary mt-1">
                        <ExternalLink size={10} /> En Google Drive
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-border">
                  <a
                    href={getDownloadUrl(doc)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
                  >
                    <Download size={12} /> Descargar
                  </a>
                  {doc.drive_file_url && (
                    <a
                      href={doc.drive_file_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary px-2 py-1.5 rounded-lg hover:bg-muted transition-colors"
                    >
                      <ExternalLink size={12} /> Drive
                    </a>
                  )}
                  <button
                    onClick={() => handleDelete(doc)}
                    className="ml-auto flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive px-2 py-1.5 rounded-lg hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 size={12} /> Eliminar
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
