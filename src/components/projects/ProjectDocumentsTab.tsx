import { useState, useEffect, useCallback } from 'react';
import { FileText, Upload, Trash2, ExternalLink, Search, FileImage, FileSpreadsheet, File, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface ProjectDocument {
  id: string;
  file_name: string;
  mime_type: string | null;
  file_size: number | null;
  storage_path: string | null;
  drive_file_url: string | null;
  description: string | null;
  uploaded_by: string;
  created_at: string;
}

interface Props {
  projectId: string;
  projectName: string;
}

const fileIcon = (mime: string | null) => {
  if (!mime) return File;
  if (mime.startsWith('image/')) return FileImage;
  if (mime.includes('spreadsheet') || mime.includes('excel') || mime.includes('csv')) return FileSpreadsheet;
  if (mime.includes('pdf') || mime.includes('document') || mime.includes('word')) return FileText;
  return File;
};

const formatFileSize = (bytes: number | null) => {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ProjectDocumentsTab = ({ projectId, projectName }: Props) => {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<ProjectDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');

  const fetchDocuments = useCallback(async () => {
    const { data, error } = await supabase
      .from('project_documents')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false });
    if (error) {
      console.error('Error fetching documents:', error);
    } else {
      setDocuments(data || []);
    }
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !user) return;

    setUploading(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('user_id', user.id)
        .maybeSingle();
      if (!profile) throw new Error('No se encontró el perfil');

      for (const file of Array.from(files)) {
        const storagePath = `${profile.tenant_id}/${projectId}/${Date.now()}_${file.name}`;

        const { error: uploadError } = await supabase.storage
          .from('project-documents')
          .upload(storagePath, file);

        if (uploadError) {
          console.error('Storage upload error:', uploadError);
          toast.error(`Error al subir ${file.name}`);
          continue;
        }

        const { error: dbError } = await supabase
          .from('project_documents')
          .insert({
            project_id: projectId,
            tenant_id: profile.tenant_id,
            file_name: file.name,
            mime_type: file.type || null,
            file_size: file.size,
            storage_path: storagePath,
            uploaded_by: user.id,
          });

        if (dbError) {
          console.error('DB insert error:', dbError);
          toast.error(`Error al registrar ${file.name}`);
        }
      }

      toast.success('Documento(s) subido(s) correctamente');
      fetchDocuments();
    } catch (err: any) {
      toast.error(err.message || 'Error al subir archivos');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
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
      toast.error('Error al eliminar');
    } else {
      toast.success('Documento eliminado');
      setDocuments(prev => prev.filter(d => d.id !== doc.id));
    }
  };

  const handleDownload = async (doc: ProjectDocument) => {
    if (doc.drive_file_url) {
      window.open(doc.drive_file_url, '_blank');
      return;
    }
    if (!doc.storage_path) return;

    const { data, error } = await supabase.storage
      .from('project-documents')
      .createSignedUrl(doc.storage_path, 300);

    if (error || !data?.signedUrl) {
      toast.error('Error al generar enlace de descarga');
      return;
    }
    window.open(data.signedUrl, '_blank');
  };

  const filtered = documents.filter(d =>
    d.file_name.toLowerCase().includes(search.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        Cargando documentos...
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
            placeholder="Buscar documentos..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 bg-muted/50 rounded-xl text-sm border border-border focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <label className={`flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-semibold px-4 py-2 rounded-xl hover:opacity-90 shadow-soft cursor-pointer transition-all ${uploading ? 'opacity-50 pointer-events-none' : 'active:scale-95'}`}>
          <Upload size={14} />
          {uploading ? 'Subiendo...' : 'Subir documento'}
          <input type="file" multiple className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>

      {/* Document list */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FileText size={40} className="text-muted-foreground/30 mb-3" />
          <p className="text-sm text-muted-foreground mb-1">
            {search ? 'No se encontraron documentos' : 'Este proyecto aún no tiene documentos'}
          </p>
          {!search && (
            <p className="text-xs text-muted-foreground">
              Sube archivos para organizar la documentación del proyecto
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(doc => {
            const Icon = fileIcon(doc.mime_type);
            return (
              <div
                key={doc.id}
                className="bg-card rounded-2xl p-3.5 flex items-center gap-3 shadow-soft hover:shadow-card transition-all"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {doc.file_size && <span>{formatFileSize(doc.file_size)}</span>}
                    <span>·</span>
                    <span>{format(new Date(doc.created_at), "d MMM yyyy", { locale: es })}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleDownload(doc)}
                    className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                    title="Descargar"
                  >
                    {doc.drive_file_url ? <ExternalLink size={14} /> : <Download size={14} />}
                  </button>
                  <button
                    onClick={() => handleDelete(doc)}
                    className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                    title="Eliminar"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ProjectDocumentsTab;
