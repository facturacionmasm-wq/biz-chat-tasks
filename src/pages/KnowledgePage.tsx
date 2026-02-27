import { useState } from 'react';
import { BookOpen, Search, Plus, Tag, User, Calendar, Lock, Globe, FileText } from 'lucide-react';
import { knowledgeArticles } from '@/data/mockData';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

const categoryColors: Record<string, string> = {
  'Procesos': 'bg-primary/10 text-primary',
  'Desarrollo': 'bg-accent text-accent-foreground',
  'Ventas': 'bg-warning/10 text-warning',
  'Seguridad': 'bg-destructive/10 text-destructive',
};

const KnowledgePage = () => {
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<string | null>(null);

  const categories = Array.from(new Set(knowledgeArticles.map(a => a.category)));
  const filtered = knowledgeArticles.filter(a =>
    (!selectedCategory || a.category === selectedCategory) &&
    (!search || a.title.toLowerCase().includes(search.toLowerCase()) || a.tags.some(t => t.includes(search.toLowerCase())))
  );

  const article = knowledgeArticles.find(a => a.id === selectedArticle);

  if (article) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <button onClick={() => setSelectedArticle(null)} className="text-sm text-muted-foreground hover:text-foreground mb-4 inline-block">← Volver</button>
        <div className="bg-card border border-border rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColors[article.category] || 'bg-muted text-muted-foreground'}`}>{article.category}</span>
            {article.isPublic ? <Globe size={12} className="text-muted-foreground" /> : <Lock size={12} className="text-muted-foreground" />}
          </div>
          <h1 className="text-xl font-bold text-foreground mb-2">{article.title}</h1>
          <div className="flex items-center gap-4 text-xs text-muted-foreground mb-4">
            <span className="flex items-center gap-1"><User size={12} /> {article.author}</span>
            <span className="flex items-center gap-1"><Calendar size={12} /> Actualizado {format(article.updatedAt, 'd MMM yyyy', { locale: es })}</span>
          </div>
          <div className="flex gap-1.5 mb-6">
            {article.tags.map(tag => (
              <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-2 py-0.5 rounded-full flex items-center gap-1">
                <Tag size={10} /> {tag}
              </span>
            ))}
          </div>
          <div className="prose prose-sm text-foreground">
            <p>{article.content}</p>
            <p className="text-muted-foreground mt-4">Este es un artículo de ejemplo. En una versión completa, aquí se mostraría el contenido completo con formato enriquecido, imágenes, enlaces y más.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-foreground flex items-center gap-2"><BookOpen size={20} className="text-primary" /> Base de Conocimiento</h1>
          <p className="text-sm text-muted-foreground mt-1">{knowledgeArticles.length} artículos · Compartidos por el equipo</p>
        </div>
        <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-lg hover:opacity-90">
          <Plus size={16} /> Nuevo Artículo
        </button>
      </div>

      {/* Search & filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex-1 flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-2">
          <Search size={16} className="text-muted-foreground" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar artículos, etiquetas..." className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setSelectedCategory(null)} className={`text-xs px-3 py-1.5 rounded-md ${!selectedCategory ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>Todos</button>
          {categories.map(cat => (
            <button key={cat} onClick={() => setSelectedCategory(cat)} className={`text-xs px-3 py-1.5 rounded-md ${selectedCategory === cat ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-secondary'}`}>{cat}</button>
          ))}
        </div>
      </div>

      {/* Articles */}
      <div className="grid grid-cols-2 gap-4">
        {filtered.map(article => (
          <button key={article.id} onClick={() => setSelectedArticle(article.id)} className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow text-left">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-primary" />
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${categoryColors[article.category] || 'bg-muted text-muted-foreground'}`}>{article.category}</span>
              {!article.isPublic && <Lock size={10} className="text-muted-foreground" />}
            </div>
            <h3 className="text-sm font-semibold text-foreground mb-1">{article.title}</h3>
            <p className="text-xs text-muted-foreground line-clamp-2 mb-3">{article.content}</p>
            <div className="flex items-center justify-between">
              <div className="flex gap-1">
                {article.tags.slice(0, 3).map(tag => (
                  <span key={tag} className="text-[10px] bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded-full">{tag}</span>
                ))}
              </div>
              <span className="text-[10px] text-muted-foreground">{format(article.updatedAt, 'd MMM', { locale: es })}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default KnowledgePage;
