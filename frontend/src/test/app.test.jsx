import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { toApiError } from '../api/client.js';
import { StatusBadge, isActive, isDone, fmtBytes } from '../components/ui.jsx';
import { VerdictCard, ReviewPanel, TextChanges, ChecksPanel } from '../components/ComparisonParts.jsx';
import ProtectedRoute from '../components/ProtectedRoute.jsx';
import ArtworkLightbox from '../components/ArtworkLightbox.jsx';
import { buildItems } from '../components/artworkGeometry.js';

let mockAuth = { user: null, loading: false };
vi.mock('../context/AuthContext.jsx', () => ({ useAuth: () => mockAuth }));
vi.mock('../context/ToastContext.jsx', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }) }));
const addReview = vi.fn().mockResolvedValue({});
vi.mock('../api/endpoints.js', () => ({ comparisonApi: { addReview: (...a) => addReview(...a), pageImageUrl: () => '' } }));

describe('api error normalisation', () => {
  it('prefers the server error envelope', () => {
    expect(toApiError({ response: { status: 422, data: { error: { code: 'PDF_ENCRYPTED', message: 'locked' } } } })).toMatchObject({ code: 'PDF_ENCRYPTED', message: 'locked', status: 422 });
  });
  it('explains network failures in plain language', () => {
    expect(toApiError({ request: {} }).message).toMatch(/cannot reach the server/i);
  });
});

describe('status helpers', () => {
  it('labels every job state and classifies them', () => {
    render(<>{['queued', 'comparing', 'generating_report', 'completed', 'completed_with_warnings', 'failed'].map((s) => <StatusBadge key={s} status={s} />)}</>);
    for (const l of ['Queued', 'Comparing', 'Generating report', 'Completed', 'Completed with warnings', 'Failed']) expect(screen.getByText(l)).toBeInTheDocument();
    expect(isActive('comparing')).toBe(true); expect(isDone('completed_with_warnings')).toBe(true); expect(isDone('failed')).toBe(false);
    expect(fmtBytes(2 * 1048576)).toBe('2.0 MB');
  });
});

describe('ProtectedRoute', () => {
  const tree = (
    <MemoryRouter initialEntries={['/secret']}><Routes><Route path="/login" element={<p>login page</p>} /><Route element={<ProtectedRoute />}><Route path="/secret" element={<p>secret page</p>} /></Route></Routes></MemoryRouter>
  );
  it('redirects anonymous visitors to login', () => { mockAuth = { user: null, loading: false }; render(tree); expect(screen.getByText('login page')).toBeInTheDocument(); });
  it('renders for signed-in users', () => { mockAuth = { user: { name: 'A' }, loading: false }; render(tree); expect(screen.getByText('secret page')).toBeInTheDocument(); });
});

describe('verdict wording', () => {
  it('never claims the artwork is error-free when nothing was detected', () => {
    render(<VerdictCard job={{ verdict: 'no_differences_detected' }} />);
    expect(screen.getByText(/No differences were detected by the checks that ran/i)).toBeInTheDocument();
    expect(screen.getByText(/not confirmation that the artwork is correct/i)).toBeInTheDocument();
  });
  it('asks for manual review when differences are found', () => {
    render(<VerdictCard job={{ verdict: 'differences_found' }} />);
    expect(screen.getByText(/manual review required/i)).toBeInTheDocument();
  });
});

describe('result parts', () => {
  it('shows original and revised text for a change', () => {
    render(<TextChanges changes={[{ type: 'replace', original: '100', revised: '1000' }]} />);
    expect(screen.getByText('100')).toBeInTheDocument(); expect(screen.getByText('1000')).toBeInTheDocument();
  });
  it('discloses checks that were not performed', () => {
    render(<ChecksPanel checks={[{ id: 'barcode', name: 'Barcode decoding and validation', status: 'not_performed' }]} limitations={[]} />);
    expect(screen.getByText(/Not performed/)).toBeInTheDocument();
  });
});

describe('ReviewPanel', () => {
  const job = { id: 'j1', reviewStatus: 'pending', warnings: [{ code: 'NO_TEXT_LAYER', message: 'scan' }] };
  it('blocks acceptance until warnings are acknowledged', async () => {
    const user = userEvent.setup(); render(<ReviewPanel job={job} reviews={[]} onSaved={() => {}} />);
    const save = screen.getByRole('button', { name: /save review/i });
    expect(save).toBeDisabled();
    await user.click(screen.getByLabelText(/read the warnings/i)); expect(save).toBeEnabled();
    await user.click(save); expect(addReview).toHaveBeenCalledWith('j1', expect.objectContaining({ decision: 'approved', acknowledgeWarnings: true }));
  });
  it('requires a comment to reject', async () => {
    const user = userEvent.setup(); render(<ReviewPanel job={{ ...job, warnings: [] }} reviews={[]} onSaved={() => {}} />);
    await user.click(screen.getByLabelText('Reject')); expect(screen.getByRole('button', { name: /save review/i })).toBeDisabled();
    await user.type(screen.getByLabelText(/Notes/), 'wrong quantity'); expect(screen.getByRole('button', { name: /save review/i })).toBeEnabled();
  });
});

describe('click-to-locate mistakes', () => {
  const pair = {
    text: { changes: [
      { type: 'replace', original: 'Baby', revised: 'Banana', originalBox: { x: 0.1, y: 0.2, w: 0.05, h: 0.02 }, revisedBox: { x: 0.1, y: 0.2, w: 0.06, h: 0.02 } },
      { type: 'add', original: '', revised: 'new line', originalBox: null, revisedBox: { x: 0.5, y: 0.5, w: 0.2, h: 0.02 } },
      { type: 'delete', original: 'old', revised: '', originalBox: { x: 0.3, y: 0.3, w: 0.1, h: 0.02 }, revisedBox: null },
    ] },
    visual: { widthPx: 2000, heightPx: 1000, originalSizePx: { w: 1000, h: 500 }, revisedSizePx: { w: 2000, h: 1000 }, regions: [{ x: 0.7, y: 0.7, w: 0.1, h: 0.1, kind: 'visible', change: 'changed' }] },
  };

  it('maps text boxes onto the padded canvas when page sizes differ', () => {
    const [first] = buildItems(pair);
    expect(first.boxes.original.x).toBeCloseTo(0.05 - 0.004, 3); // 0.1 * (1000 / 2000), minus padding
    expect(first.boxes.revised.x).toBeCloseTo(0.1 - 0.004, 3);
  });

  it('shows added/removed text as a dashed "ghost" on the side that lacks it, and lists visual regions', () => {
    const items = buildItems(pair);
    expect(items.map((i) => i.id)).toEqual(['t0', 't1', 't2', 'v0']);
    expect(items[1].boxes.original.ghost).toBe(true); expect(items[1].boxes.revised.ghost).toBeUndefined();
    expect(items[2].boxes.revised.ghost).toBe(true);
  });

  it('TextChanges reports which change was clicked and marks it selected', async () => {
    const onSelect = vi.fn(); const changes = pair.text.changes;
    render(<TextChanges changes={changes} selectedIndex={0} onSelect={onSelect} />);
    expect(screen.getByText('Shown on artwork')).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button')[1]);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('full-screen viewer is a modal dialog that lists mistakes and closes with Escape', async () => {
    globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
    const onClose = vi.fn(); const onFocus = vi.fn();
    render(<ArtworkLightbox urls={{ original: '/o.png', revised: '/r.png' }} items={buildItems(pair)} focusId="t0" onFocus={onFocus} title="Page 1" size={{ w: 2000, h: 1000 }} onClose={onClose} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Mistakes on this page \(4\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next mistake/i }));
    expect(onFocus).toHaveBeenCalledWith('t1');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});