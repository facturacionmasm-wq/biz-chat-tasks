import { useState } from 'react';
import { Task } from '@/types/app';
import { CheckCircle2, Circle, Clock, Plus, ArrowUpCircle, ArrowRightCircle, ArrowDownCircle } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

interface TaskBoardProps {
  tasks: Task[];
  onUpdateTask: (id: string, status: Task['status']) => void;
}

const priorityConfig = {
  high: { icon: ArrowUpCircle, label: 'Alta', className: 'text-destructive' },
  medium: { icon: ArrowRightCircle, label: 'Media', className: 'text-warning' },
  low: { icon: ArrowDownCircle, label: 'Baja', className: 'text-muted-foreground' },
};

const statusConfig = {
  todo: { icon: Circle, label: 'Por Hacer', headerClass: 'text-muted-foreground', dotClass: 'bg-muted-foreground' },
  in_progress: { icon: Clock, label: 'En Progreso', headerClass: 'text-warning', dotClass: 'bg-warning' },
  done: { icon: CheckCircle2, label: 'Completado', headerClass: 'text-success', dotClass: 'bg-success' },
};

const columns: Task['status'][] = ['todo', 'in_progress', 'done'];

const TaskBoard = ({ tasks, onUpdateTask }: TaskBoardProps) => {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="h-14 shrink-0 border-b border-border flex items-center justify-between px-5 bg-card">
        <h2 className="font-semibold text-foreground">Tablero de Tareas</h2>
        <button className="flex items-center gap-1.5 bg-primary text-primary-foreground text-sm font-medium px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity">
          <Plus size={14} />
          Nueva Tarea
        </button>
      </div>

      {/* Board */}
      <div className="flex-1 overflow-x-auto p-4">
        <div className="grid grid-cols-3 gap-4 h-full min-w-[600px]">
          {columns.map(status => {
            const config = statusConfig[status];
            const columnTasks = tasks.filter(t => t.status === status);

            return (
              <div key={status} className="flex flex-col">
                <div className="flex items-center gap-2 mb-3 px-1">
                  <div className={`w-2 h-2 rounded-full ${config.dotClass}`} />
                  <span className={`text-sm font-semibold ${config.headerClass}`}>{config.label}</span>
                  <span className="text-xs text-muted-foreground bg-muted rounded-full w-5 h-5 flex items-center justify-center">
                    {columnTasks.length}
                  </span>
                </div>

                <div className="flex-1 space-y-2 overflow-y-auto scrollbar-thin">
                  {columnTasks.map(task => {
                    const PriorityIcon = priorityConfig[task.priority].icon;
                    return (
                      <div
                        key={task.id}
                        className="bg-card border border-border rounded-lg p-3 shadow-sm hover:shadow-md transition-shadow animate-slide-in cursor-pointer"
                      >
                        <div className="flex items-start justify-between mb-2">
                          <h4 className="text-sm font-medium text-foreground leading-tight">{task.title}</h4>
                          <PriorityIcon size={16} className={`shrink-0 ml-2 ${priorityConfig[task.priority].className}`} />
                        </div>
                        {task.description && (
                          <p className="text-xs text-muted-foreground mb-2 line-clamp-2">{task.description}</p>
                        )}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <div className="w-5 h-5 rounded-full bg-secondary flex items-center justify-center text-[10px] font-bold text-secondary-foreground">
                              {task.assignee.split(' ').map(n => n[0]).join('')}
                            </div>
                            <span className="text-xs text-muted-foreground">{task.assignee.split(' ')[0]}</span>
                          </div>
                          {task.dueDate && (
                            <span className="text-xs text-muted-foreground">
                              {format(task.dueDate, 'd MMM', { locale: es })}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TaskBoard;
