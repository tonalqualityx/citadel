'use client';

import { use } from 'react';
import { PublishPage } from '@/components/domain/design/PublishPage';

export default function DesignPublishPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <PublishPage publishId={id} />;
}
