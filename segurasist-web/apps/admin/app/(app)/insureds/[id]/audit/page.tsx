import { Avatar, AvatarFallback, initialsOf } from '@segurasist/ui';

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  ts: string;
  ip: string;
}

const MOCK: AuditEntry[] = [
  { id: 'a1', actor: 'Lucía Operadora', action: 'Reemitió certificado v3', ts: '2026-04-21 10:14', ip: '189.203.10.5' },
  { id: 'a2', actor: 'Roberto Admin', action: 'Editó datos personales', ts: '2026-04-19 16:02', ip: '189.203.10.7' },
];

export default function InsuredAuditPage() {
  return (
    <ol className="space-y-4">
      {MOCK.map((entry) => (
        <li key={entry.id} className="flex gap-3">
          <Avatar>
            <AvatarFallback>{initialsOf(entry.actor)}</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <p className="text-sm">
              <span className="font-medium">{entry.actor}</span> · {entry.action}
            </p>
            <p className="text-xs text-fg-muted">
              {entry.ts} · IP {entry.ip}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
