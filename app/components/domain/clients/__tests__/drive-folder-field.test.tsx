import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DriveFolderField } from '../drive-folder-field';

const FOLDER = '1AbCdEfGhIjKlMnOpQrStUvWxYz_-0123456789';
const ID = 'abababab-abab-4bab-8bab-abababababab';

let role = 'admin';
vi.mock('@/lib/hooks/use-auth', () => ({
  useAuth: () => ({ isAdmin: role === 'admin', user: { role } }),
}));

const get = vi.fn();
const patch = vi.fn();
vi.mock('@/lib/api/client', () => ({ apiClient: { get: (...a: unknown[]) => get(...a), patch: (...a: unknown[]) => patch(...a) } }));

const toast = { success: vi.fn(), apiError: vi.fn() };
vi.mock('@/lib/hooks/use-toast', () => ({ showToast: { success: (...a: unknown[]) => toast.success(...a), apiError: (...a: unknown[]) => toast.apiError(...a) } }));

function renderField(kind: 'clients' | 'projects' = 'clients') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DriveFolderField kind={kind} id={ID} label="Client Drive folder" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  role = 'admin';
  get.mockResolvedValue({ id: ID, drive_folder_id: null });
  patch.mockResolvedValue({ client: { id: ID, drive_folder_id: FOLDER } });
});

describe('DriveFolderField', () => {
  it('shows the helper text and reads the current value', async () => {
    get.mockResolvedValue({ id: ID, drive_folder_id: FOLDER });
    renderField();
    expect(screen.getByText('The folder in the shared Clients drive the Designer Portal may read. Paste the id from the Drive URL.')).toBeTruthy();
    expect(get).toHaveBeenCalledWith(`/design/admin/clients/${ID}`);
    await waitFor(() => expect((screen.getByLabelText('Client Drive folder') as HTMLInputElement).value).toBe(FOLDER));
  });

  it('admin sets the folder id: PATCH body is { drive_folder_id } and a success toast shows', async () => {
    const user = userEvent.setup();
    renderField();
    await user.type(screen.getByLabelText('Client Drive folder'), `  ${FOLDER}  `);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/design/admin/clients/${ID}`, { drive_folder_id: FOLDER }));
    expect(toast.success).toHaveBeenCalledWith('Drive folder saved');
  });

  it('admin clears the folder: PATCH body is { drive_folder_id: null }', async () => {
    get.mockResolvedValue({ id: ID, drive_folder_id: FOLDER });
    const user = userEvent.setup();
    renderField();
    await waitFor(() => expect((screen.getByLabelText('Client Drive folder') as HTMLInputElement).value).toBe(FOLDER));
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/design/admin/clients/${ID}`, { drive_folder_id: null }));
    expect(toast.success).toHaveBeenCalledWith('Drive folder cleared');
  });

  it('project variant patches the projects route', async () => {
    const user = userEvent.setup();
    renderField('projects');
    await user.type(screen.getByLabelText('Client Drive folder'), FOLDER);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(`/design/admin/projects/${ID}`, { drive_folder_id: FOLDER }));
  });

  it('an invalid id shows a validation message and never calls the API', async () => {
    const user = userEvent.setup();
    renderField();
    const input = screen.getByLabelText('Client Drive folder');
    for (const bad of ['short', 'https://drive.google.com/drive/folders/' + FOLDER, FOLDER + '/x', 'a'.repeat(101)]) {
      await user.clear(input);
      await user.type(input, bad);
      await user.click(screen.getByRole('button', { name: 'Save' }));
      expect(await screen.findByText(/Not a Drive folder id/)).toBeTruthy();
    }
    expect(patch).not.toHaveBeenCalled();
  });

  it('an API error shows the error toast', async () => {
    patch.mockRejectedValue(new Error('boom'));
    const user = userEvent.setup();
    renderField();
    await user.type(screen.getByLabelText('Client Drive folder'), FOLDER);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    await waitFor(() => expect(toast.apiError).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it.each(['pm', 'tech', 'designer'])('%s never renders the field and never reads it', async (r) => {
    role = r;
    const { container } = renderField();
    expect(container.innerHTML).toBe('');
    expect(screen.queryByText('Client Drive folder')).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});
