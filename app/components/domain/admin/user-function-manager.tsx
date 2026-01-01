'use client';

import * as React from 'react';
import { Plus, X, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select } from '@/components/ui/select';
import { Spinner } from '@/components/ui/spinner';
import { useFunctions } from '@/lib/hooks/use-reference-data';
import {
  useUserFunctions,
  useAddUserFunction,
  useRemoveUserFunction,
  useSetPrimaryFunction,
} from '@/lib/hooks/use-user-functions';

interface UserFunctionManagerProps {
  userId: string;
}

export function UserFunctionManager({ userId }: UserFunctionManagerProps) {
  const [selectedFunctionId, setSelectedFunctionId] = React.useState<string>('');

  const { data: functionsData, isLoading: functionsLoading } = useFunctions();
  const { data: userFunctionsData, isLoading: userFunctionsLoading } = useUserFunctions(userId);
  const addMutation = useAddUserFunction();
  const removeMutation = useRemoveUserFunction();
  const setPrimaryMutation = useSetPrimaryFunction();

  const userFunctions = userFunctionsData?.user_functions || [];
  const allFunctions = functionsData?.functions || [];

  // Filter out functions already assigned to user
  const assignedFunctionIds = new Set(userFunctions.map((uf) => uf.function_id));
  const availableFunctions = allFunctions.filter((f) => !assignedFunctionIds.has(f.id));

  const handleAdd = async () => {
    if (!selectedFunctionId) return;
    await addMutation.mutateAsync({
      userId,
      data: { function_id: selectedFunctionId, is_primary: userFunctions.length === 0 },
    });
    setSelectedFunctionId('');
  };

  const handleRemove = async (functionId: string) => {
    await removeMutation.mutateAsync({ userId, functionId });
  };

  const handleSetPrimary = async (functionId: string) => {
    await setPrimaryMutation.mutateAsync({ userId, functionId, isPrimary: true });
  };

  if (functionsLoading || userFunctionsLoading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Current functions */}
      {userFunctions.length > 0 ? (
        <div className="space-y-2">
          {userFunctions.map((uf) => (
            <div
              key={uf.id}
              className="flex items-center justify-between p-2 rounded-md bg-surface-alt border border-border"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-main">{uf.function?.name}</span>
                {uf.is_primary && (
                  <Badge variant="info" className="text-xs">
                    Primary
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1">
                {!uf.is_primary && userFunctions.length > 1 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleSetPrimary(uf.function_id)}
                    disabled={setPrimaryMutation.isPending}
                    title="Set as primary"
                  >
                    <Star className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemove(uf.function_id)}
                  disabled={removeMutation.isPending}
                  className="text-red-500 hover:text-red-700"
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-sub italic">No functions assigned</p>
      )}

      {/* Add function */}
      {availableFunctions.length > 0 && (
        <div className="flex items-center gap-2">
          <Select
            options={[
              { value: '', label: 'Select function...' },
              ...availableFunctions.map((f) => ({ value: f.id, label: f.name })),
            ]}
            value={selectedFunctionId}
            onChange={setSelectedFunctionId}
            className="flex-1"
          />
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!selectedFunctionId || addMutation.isPending}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      )}

      {availableFunctions.length === 0 && userFunctions.length > 0 && (
        <p className="text-xs text-text-sub">All functions assigned</p>
      )}
    </div>
  );
}
