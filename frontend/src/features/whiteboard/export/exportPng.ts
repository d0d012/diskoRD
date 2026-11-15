import { useGuildStore } from '../../../stores/guildStore';
import type { BoardStore } from '../contract';
import { filterVisibleObjects } from '../state';
import type { BoardNotify, SessionStore } from '../state';
import { downloadBlob } from '../../pixelart/render';
import { exportFilename } from './filename';
import { exportRegion } from './region';
import { planExport } from './scale';
import { renderExport } from './render';

/** 'auto' resolves frame > selection > whole board; 'board' forces the whole board. */
export type ExportTarget = 'auto' | 'board';

function resolveChannelName(boardId?: string): string {
  if (!boardId) return '';
  const channels = useGuildStore.getState().channels;
  for (const list of Object.values(channels)) {
    const channel = list.find(item => item.id === boardId);
    if (channel) return channel.name;
  }
  return '';
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
}

/**
 * Exports the board (or selection/frame) to a downloaded PNG. Selection is
 * honoured only for the 'auto' target. Skips images that fail to load or would
 * taint the canvas, reporting them through the board notice channel.
 */
export async function exportBoardPng(
  store: BoardStore,
  session: SessionStore,
  notify: BoardNotify,
  target: ExportTarget = 'auto',
): Promise<void> {
  const channelName = resolveChannelName(store.getBoardId?.());
  const objects = filterVisibleObjects(store.getObjectsInRank(), session);
  const selectedIds = target === 'board' ? [] : session.getState().selectedIds;
  const region = exportRegion({ objects, selectedIds, channelName });
  if (!region) {
    notify('export', 'There is nothing to export.');
    return;
  }
  const plan = planExport(region.bounds);
  try {
    const { canvas, skippedImages } = await renderExport(region, plan);
    const blob = await canvasToBlob(canvas);
    if (!blob) {
      notify('export', 'The PNG could not be created.');
      return;
    }
    downloadBlob(blob, exportFilename(region.name));
    if (skippedImages > 0) {
      notify('export', skippedImages === 1
        ? 'One image was skipped because it could not be included.'
        : `${skippedImages} images were skipped because they could not be included.`);
    }
  } catch (cause) {
    if (import.meta.env.DEV) console.warn('whiteboard: export failed', cause);
    notify('export', 'The board could not be exported.');
  }
}
