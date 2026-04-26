import Link from 'next/link';
import {
  Badge,
  Breadcrumbs,
  Button,
  Section,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@segurasist/ui';
import { FileSignature } from 'lucide-react';

interface PageProps {
  params: { id: string };
}

export default function InsuredDetailPage({ params }: PageProps) {
  const insuredId = params.id;
  return (
    <div className="space-y-4">
      <Breadcrumbs
        items={[
          { label: 'Inicio', href: '/dashboard' },
          { label: 'Asegurados', href: '/insureds' },
          { label: insuredId },
        ]}
      />
      <Section
        title={
          <span className="flex items-center gap-3">
            Carmen López <Badge variant="success">Vigente</Badge>
          </span>
        }
        description={`CURP: ${insuredId}`}
        actions={
          <Button>
            <FileSignature aria-hidden className="mr-2 h-4 w-4" />
            Reemitir certificado
          </Button>
        }
      />

      <Tabs defaultValue="data">
        <TabsList>
          <TabsTrigger value="data" asChild>
            <Link href={`/insureds/${insuredId}`}>Datos</Link>
          </TabsTrigger>
          <TabsTrigger value="coverages" asChild>
            <Link href={`/insureds/${insuredId}/coverages`}>Coberturas</Link>
          </TabsTrigger>
          <TabsTrigger value="claims" asChild>
            <Link href={`/insureds/${insuredId}/claims`}>Eventos</Link>
          </TabsTrigger>
          <TabsTrigger value="certificates" asChild>
            <Link href={`/insureds/${insuredId}/certificates`}>Certificados</Link>
          </TabsTrigger>
          <TabsTrigger value="audit" asChild>
            <Link href={`/insureds/${insuredId}/audit`}>Auditoría</Link>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="data">
          <p className="text-sm text-fg-muted">
            Pendiente: panel con datos personales editables y datos de la póliza.
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
