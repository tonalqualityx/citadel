/**
 * Recording one reading for an initiative number. Shared by the readings route and the nightly Citadel read
 * (lib/initiatives/citadel-numbers.ts) so the two cannot drift.
 */
import { prisma } from '@/lib/db/prisma';

type NumberRow = {
  id: string;
  baseline_value: unknown;
  last_read_at: Date | null;
};

/**
 * Create the reading. The newest reading becomes the number's last value; an older, back-dated one is kept but does
 * not replace it. A number with no baseline takes this reading as its baseline.
 * Returns the stored reading and the number as it stands afterwards. Does not recompute health.
 */
export async function recordReading<N extends NumberRow>(number: N, value: number, readAt: Date, source: string) {
  const reading = await prisma.initiativeReading.create({
    data: { number_id: number.id, value, read_at: readAt, source },
  });

  const numberUpdate: Record<string, unknown> = {};
  if (!number.last_read_at || readAt.getTime() >= number.last_read_at.getTime()) {
    numberUpdate.last_value = value;
    numberUpdate.last_read_at = readAt;
  }
  if (number.baseline_value === null || number.baseline_value === undefined) {
    numberUpdate.baseline_value = value;
    numberUpdate.baseline_at = readAt;
  }
  const updatedNumber = Object.keys(numberUpdate).length
    ? await prisma.initiativeNumber.update({ where: { id: number.id }, data: numberUpdate })
    : number;

  return { reading, number: updatedNumber };
}
