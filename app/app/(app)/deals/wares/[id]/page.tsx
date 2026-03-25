'use client';

import * as React from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Package,
  Plus,
  Trash2,
  GripVertical,
} from 'lucide-react';
import { useWare, useUpdateWare } from '@/lib/hooks/use-wares';
import { useRecipes } from '@/lib/hooks/use-recipes';
import { useTerminology } from '@/lib/hooks/use-terminology';
import { showToast } from '@/lib/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Spinner } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { RichTextEditor, type BlockNoteContent } from '@/components/ui/rich-text-editor';
import { Combobox } from '@/components/ui/combobox';

// ── Helpers ──

function formatCurrency(amount: number | null): string {
  if (amount === null || amount === undefined) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
}

const typeOptions = [
  { value: 'commission', label: 'Commission' },
  { value: 'charter', label: 'Charter' },
];

const billingPeriodOptions = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'annually', label: 'Annually' },
];

const cadenceOptions = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annually', label: 'Semi-Annually' },
  { value: 'annually', label: 'Annually' },
];

// ── Types ──

interface PriceTier {
  name: string;
  price: number;
  description: string;
}

interface ScheduleItem {
  sop_name: string;
  cadence: string;
}

// ── Component ──

export default function WareDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useTerminology();
  const id = params.id as string;

  const { data: ware, isLoading, error } = useWare(id);
  const updateWare = useUpdateWare();
  const { data: recipesData } = useRecipes();

  const recipeOptions = React.useMemo(
    () =>
      recipesData?.recipes
        ?.filter((r: any) => r.is_active)
        .map((r: any) => ({
          value: r.id,
          label: r.name,
          description: typeof r.description === 'string' ? r.description : undefined,
        })) ?? [],
    [recipesData]
  );

  // ── Local state for editable fields ──
  const [name, setName] = React.useState('');
  const [type, setType] = React.useState<'commission' | 'charter'>('commission');
  const [basePrice, setBasePrice] = React.useState('');
  const [billingPeriod, setBillingPeriod] = React.useState<string>('');
  const [isActive, setIsActive] = React.useState(true);
  const [description, setDescription] = React.useState<BlockNoteContent | null>(null);
  const [contractLanguage, setContractLanguage] = React.useState<BlockNoteContent | null>(null);
  const [priceTiers, setPriceTiers] = React.useState<PriceTier[]>([]);
  const [defaultSchedule, setDefaultSchedule] = React.useState<ScheduleItem[]>([]);
  const [recipeId, setRecipeId] = React.useState<string | null>(null);

  // Track whether we've loaded initial data
  const [initialized, setInitialized] = React.useState(false);

  // Populate state when ware data loads
  React.useEffect(() => {
    if (ware && !initialized) {
      setName(ware.name);
      setType(ware.type);
      setBasePrice(ware.base_price != null ? ware.base_price.toString() : '');
      setBillingPeriod(ware.charter_billing_period || '');
      setIsActive(ware.is_active);
      setDescription(ware.description ? parseJsonContent(ware.description) : null);
      setContractLanguage(ware.contract_language ? parseJsonContent(ware.contract_language) : null);
      setPriceTiers(parsePriceTiers(ware.price_tiers));
      setDefaultSchedule(parseSchedule(ware.default_schedule));
      setRecipeId(ware.recipe?.id ?? null);
      setInitialized(true);
    }
  }, [ware, initialized]);

  // ── Save handler ──

  const handleSave = async () => {
    const payload: Record<string, unknown> = {
      name,
      type,
      is_active: isActive,
    };

    const parsedPrice = parseFloat(basePrice);
    payload.base_price = !isNaN(parsedPrice) ? parsedPrice : null;

    if (type === 'charter' && billingPeriod) {
      payload.charter_billing_period = billingPeriod;
    } else {
      payload.charter_billing_period = null;
    }

    payload.description = description ? JSON.stringify(description) : null;
    payload.contract_language = contractLanguage ? JSON.stringify(contractLanguage) : null;
    payload.price_tiers = priceTiers.length > 0 ? priceTiers : null;
    payload.default_schedule = defaultSchedule.length > 0 ? defaultSchedule : null;
    payload.recipe_id = recipeId;

    await updateWare.mutateAsync({ id, data: payload as any });
  };

  // ── Loading / Error states ──

  if (isLoading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-[400px]">
        <Spinner size="lg" />
      </div>
    );
  }

  if (error || !ware) {
    return (
      <div className="p-6">
        <EmptyState
          icon={<Package className="h-12 w-12" />}
          title={`${t('product')} not found`}
          description={`The ${t('product').toLowerCase()} you're looking for doesn't exist or has been deleted.`}
          action={
            <Button onClick={() => router.push('/deals/wares')}>
              Back to {t('products')}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Back link */}
      <Link
        href="/deals/wares"
        className="inline-flex items-center gap-1.5 text-sm text-text-sub hover:text-text-main transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {t('products')}
      </Link>

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-text-main">
              {ware.name}
            </h1>
            <Badge variant={ware.type === 'commission' ? 'purple' : 'info'}>
              {ware.type === 'commission' ? 'Commission' : 'Charter'}
            </Badge>
            <div className="flex items-center gap-2 ml-2">
              <Switch
                checked={isActive}
                onCheckedChange={(checked) => setIsActive(checked)}
              />
              <span className="text-sm text-text-sub">
                {isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
          </div>
        </div>

        <Button
          onClick={handleSave}
          disabled={updateWare.isPending}
        >
          {updateWare.isPending && <Spinner size="sm" className="mr-2" />}
          Save Changes
        </Button>
      </div>

      {/* Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle>Basic Info</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Product name"
            />
            <div>
              <label className="block text-sm font-medium text-text-main mb-1.5">
                Type
              </label>
              <Select
                options={typeOptions}
                value={type}
                onChange={(value) => setType(value as 'commission' | 'charter')}
              />
            </div>
            <Input
              label="Base Price"
              type="number"
              step="0.01"
              value={basePrice}
              onChange={(e) => setBasePrice(e.target.value)}
              placeholder="0.00"
            />
            {type === 'charter' && (
              <div>
                <label className="block text-sm font-medium text-text-main mb-1.5">
                  Charter Billing Period
                </label>
                <Select
                  options={billingPeriodOptions}
                  value={billingPeriod}
                  onChange={setBillingPeriod}
                  placeholder="Select billing period..."
                />
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Description */}
      <Card>
        <CardHeader>
          <CardTitle>Description</CardTitle>
        </CardHeader>
        <CardContent>
          <RichTextEditor
            content={description}
            onChange={setDescription}
            placeholder="Describe this product..."
          />
        </CardContent>
      </Card>

      {/* Contract Language */}
      <Card>
        <CardHeader>
          <CardTitle>Contract Language</CardTitle>
        </CardHeader>
        <CardContent>
          <RichTextEditor
            content={contractLanguage}
            onChange={setContractLanguage}
            placeholder="Default contract language for this product..."
          />
        </CardContent>
      </Card>

      {/* Pricing Tiers */}
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Pricing Tiers</CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setPriceTiers([...priceTiers, { name: '', price: 0, description: '' }])
            }
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Tier
          </Button>
        </CardHeader>
        <CardContent>
          {priceTiers.length === 0 ? (
            <p className="text-sm text-text-sub py-4 text-center">
              No pricing tiers defined. Add tiers for tiered pricing options.
            </p>
          ) : (
            <div className="space-y-3">
              {priceTiers.map((tier, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 p-3 rounded-lg border border-border bg-surface"
                >
                  <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-3">
                    <Input
                      label="Tier Name"
                      value={tier.name}
                      onChange={(e) => {
                        const updated = [...priceTiers];
                        updated[index] = { ...tier, name: e.target.value };
                        setPriceTiers(updated);
                      }}
                      placeholder="e.g. Basic, Pro, Enterprise"
                    />
                    <Input
                      label="Price"
                      type="number"
                      step="0.01"
                      value={tier.price.toString()}
                      onChange={(e) => {
                        const updated = [...priceTiers];
                        updated[index] = {
                          ...tier,
                          price: parseFloat(e.target.value) || 0,
                        };
                        setPriceTiers(updated);
                      }}
                      placeholder="0.00"
                    />
                    <Input
                      label="Description"
                      value={tier.description}
                      onChange={(e) => {
                        const updated = [...priceTiers];
                        updated[index] = { ...tier, description: e.target.value };
                        setPriceTiers(updated);
                      }}
                      placeholder="What's included..."
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-6"
                    onClick={() => {
                      setPriceTiers(priceTiers.filter((_, i) => i !== index));
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-text-sub hover:text-red-500" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Default Schedule (Charter Wares only) */}
      {type === 'charter' && (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Default Schedule</CardTitle>
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                setDefaultSchedule([
                  ...defaultSchedule,
                  { sop_name: '', cadence: 'monthly' },
                ])
              }
            >
              <Plus className="h-4 w-4 mr-1" />
              Add SOP
            </Button>
          </CardHeader>
          <CardContent>
            {defaultSchedule.length === 0 ? (
              <p className="text-sm text-text-sub py-4 text-center">
                No default schedule defined. Add SOPs with their cadence.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 font-medium text-text-sub">
                        SOP Name
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-text-sub">
                        Cadence
                      </th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {defaultSchedule.map((item, index) => (
                      <tr
                        key={index}
                        className="border-b border-border last:border-0"
                      >
                        <td className="py-2 px-3">
                          <Input
                            value={item.sop_name}
                            onChange={(e) => {
                              const updated = [...defaultSchedule];
                              updated[index] = {
                                ...item,
                                sop_name: e.target.value,
                              };
                              setDefaultSchedule(updated);
                            }}
                            placeholder="SOP name..."
                          />
                        </td>
                        <td className="py-2 px-3">
                          <Select
                            options={cadenceOptions}
                            value={item.cadence}
                            onChange={(value) => {
                              const updated = [...defaultSchedule];
                              updated[index] = { ...item, cadence: value };
                              setDefaultSchedule(updated);
                            }}
                          />
                        </td>
                        <td className="py-2 px-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setDefaultSchedule(
                                defaultSchedule.filter((_, i) => i !== index)
                              )
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5 text-text-sub hover:text-red-500" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Default Recipe (Commission Wares only) */}
      {type === 'commission' && (
        <Card>
          <CardHeader>
            <CardTitle>Default Recipe</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Combobox
                options={recipeOptions}
                value={recipeId}
                onChange={setRecipeId}
                placeholder="Select a recipe..."
              />
              <p className="text-xs text-text-sub">
                Linked recipe auto-populates tasks when this ware is used in a commission.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ── Utility functions ──

function parseJsonContent(raw: string | null): BlockNoteContent | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // If it's plain text, return null and let the editor handle it
    return null;
  }
}

function parsePriceTiers(raw: any): PriceTier[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseSchedule(raw: any): ScheduleItem[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
