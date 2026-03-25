'use client';

import * as React from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useCreateWare } from '@/lib/hooks/use-wares';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { Modal, ModalContent, ModalHeader, ModalTitle, ModalBody } from '@/components/ui/modal';

const wareCreateSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.enum(['commission', 'charter']),
});

type WareCreateFormData = z.infer<typeof wareCreateSchema>;

interface WareFormProps {
  open: boolean;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

const typeOptions = [
  { value: 'commission', label: 'Commission' },
  { value: 'charter', label: 'Charter' },
];

export function WareForm({ open, onClose, onCreated }: WareFormProps) {
  const { t } = useTerminology();
  const createWare = useCreateWare();
  const [navigateAfter, setNavigateAfter] = React.useState(false);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<WareCreateFormData>({
    resolver: zodResolver(wareCreateSchema),
    defaultValues: {
      name: '',
      type: 'commission',
    },
  });

  React.useEffect(() => {
    if (open) {
      reset({ name: '', type: 'commission' });
      setNavigateAfter(false);
    }
  }, [open, reset]);

  const onSubmit = async (data: WareCreateFormData) => {
    try {
      const result = await createWare.mutateAsync({
        name: data.name,
        type: data.type,
        is_active: true,
      });
      onClose();
      if (navigateAfter && result?.id && onCreated) {
        onCreated(result.id);
      }
    } catch (error) {
      console.error('Failed to create ware:', error);
    }
  };

  return (
    <Modal open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <ModalContent>
        <ModalHeader>
          <ModalTitle>{t('newProduct')}</ModalTitle>
        </ModalHeader>
        <ModalBody>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <Input
              label="Name"
              {...register('name')}
              error={errors.name?.message}
              placeholder="Product name"
            />

            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Type
              </label>
              <Select
                options={typeOptions}
                value={watch('type')}
                onChange={(value) =>
                  setValue('type', value as WareCreateFormData['type'])
                }
              />
            </div>

            <div className="flex justify-end gap-3 pt-4">
              <Button type="button" variant="secondary" onClick={onClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                variant="secondary"
                disabled={createWare.isPending}
                onClick={() => setNavigateAfter(false)}
              >
                {createWare.isPending && !navigateAfter && (
                  <Spinner size="sm" className="mr-2" />
                )}
                Create
              </Button>
              <Button
                type="submit"
                disabled={createWare.isPending}
                onClick={() => setNavigateAfter(true)}
              >
                {createWare.isPending && navigateAfter && (
                  <Spinner size="sm" className="mr-2" />
                )}
                Create &amp; Open
              </Button>
            </div>
          </form>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}
