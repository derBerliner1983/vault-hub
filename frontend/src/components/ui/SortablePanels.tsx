import { useState, type ReactNode } from 'react';
import { GripVertical } from 'lucide-react';
import { tt } from '../../lib/i18n';
import { useOrder } from '../../lib/prefs';

export interface SortableItem {
  id: string;
  node: ReactNode;
}

function ordered(items: SortableItem[], saved: string[]): SortableItem[] {
  if (saved.length === 0) return items;
  const rank = new Map(saved.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999));
}

/**
 * Vertikale Liste von Panels, die sich per Drag & Drop sortieren lässt.
 * Gezogen wird nur über den Griff (links), damit das Auf-/Zuklappen der
 * Panels nicht ausgelöst wird. Die Reihenfolge wird im Browser gespeichert.
 */
export function SortablePanels({ storageKey, items }: { storageKey: string; items: SortableItem[] }) {
  const [order, setOrder] = useOrder('panelOrder', storageKey);   // pro-Benutzer serverseitig gespeichert
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);   // Panel, dessen Griff gegriffen wurde

  const list = ordered(items, order);

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) { setDragId(null); setOverId(null); return; }
    const ids = list.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) { setDragId(null); setOverId(null); return; }
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
    setDragId(null); setOverId(null); setArmed(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {list.map((it) => {
        const isOver = overId === it.id && dragId && dragId !== it.id;
        return (
          <div
            key={it.id}
            draggable={armed === it.id}
            onDragStart={(e) => { setDragId(it.id); e.dataTransfer.effectAllowed = 'move'; }}
            onDragEnd={() => { setDragId(null); setOverId(null); setArmed(null); }}
            onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(it.id); } }}
            onDrop={(e) => { e.preventDefault(); drop(it.id); }}
            style={{
              position: 'relative',
              opacity: dragId === it.id ? 0.4 : 1,
              borderRadius: 10,
              boxShadow: isOver ? 'inset 0 3px 0 var(--color-accent)' : 'none',
              transition: 'box-shadow .12s',
            }}
          >
            {/* Griff zum Ziehen */}
            <button
              type="button"
              title={tt('Zum Sortieren ziehen')}
              onMouseDown={() => setArmed(it.id)}
              onMouseUp={() => setArmed(null)}
              onClick={(e) => e.preventDefault()}
              style={{
                position: 'absolute', left: -2, top: 12, zIndex: 2,
                background: 'none', border: 'none', cursor: 'grab', padding: '4px 2px',
                color: 'var(--color-faint)', display: 'flex', alignItems: 'center',
              }}
            >
              <GripVertical size={15} />
            </button>
            {it.node}
          </div>
        );
      })}
    </div>
  );
}
