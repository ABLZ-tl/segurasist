'use client';

import * as React from 'react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DatePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@segurasist/ui';

const MAX_DESC = 500;

export default function NewClaimPage() {
  const [type, setType] = React.useState('');
  const [date, setDate] = React.useState<Date | undefined>();
  const [desc, setDesc] = React.useState('');

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // TODO wire to useCreateClaim() once available.
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Nuevo evento</h1>
      <Card>
        <CardHeader>
          <CardTitle>Cuéntanos qué ocurrió</CardTitle>
          <CardDescription>Te responderemos en menos de 24 h.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-1">
              <label htmlFor="claim-type" className="text-sm font-medium">
                Tipo de evento
              </label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger id="claim-type" aria-label="Tipo de evento">
                  <SelectValue placeholder="Selecciona..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="hospitalization">Hospitalización</SelectItem>
                  <SelectItem value="consultation">Consulta</SelectItem>
                  <SelectItem value="study">Estudio</SelectItem>
                  <SelectItem value="medication">Medicamento</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <span className="text-sm font-medium">Fecha</span>
              <DatePicker value={date} onChange={setDate} ariaLabel="Fecha del evento" />
            </div>

            <div className="space-y-1">
              <label htmlFor="claim-desc" className="text-sm font-medium">
                Descripción
              </label>
              <Textarea
                id="claim-desc"
                rows={5}
                maxLength={MAX_DESC}
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Describe brevemente lo ocurrido..."
              />
              <p className="text-right text-xs text-fg-muted">
                {desc.length}/{MAX_DESC}
              </p>
            </div>

            <Button type="submit" className="w-full" disabled={!type || !date || !desc}>
              Enviar
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
