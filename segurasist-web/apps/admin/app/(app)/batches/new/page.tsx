import { AccessDenied } from '../../../_components/access-denied';
import { fetchMe } from '../../../../lib/auth-server';
import { canAccess } from '../../../../lib/rbac';
import { NewBatchWizard } from './new-batch-wizard';

export const dynamic = 'force-dynamic';

/** Server gate for the create-batch wizard. The wizard itself is a client
 *  component so we wrap it after the role check. */
export default async function NewBatchPage() {
  const me = await fetchMe();
  if (!me.role || !canAccess('/batches/new', me.role)) {
    return <AccessDenied />;
  }
  return <NewBatchWizard />;
}
