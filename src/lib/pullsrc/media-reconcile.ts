import { headSafely, mapWithConcurrency } from "./server/http";
import { isBareSegment, probeMp4Track } from "./server/media-probe";

// Shared by the web app's scan route and the extension's panel. This logic is
// subtle and was arrived at by probing real files — a second copy would drift,
// and the failure mode is silent (a video that plays without sound), so both
// callers use this one.

export interface TrackCandidate {
  url: string;
  isStreaming: boolean;
  quality?: string;
  variants?: TrackCandidate[];
  audioUrl?: string;
}

export interface ReconciledTracks<T> {
  videos: T[];
  audio: T[];
}

// Each probe is a ~4KB ranged read, cheap individually but not free in bulk.
const MAX_TRACK_PROBES = 8;

// Big CDNs shard across numbered edge hosts — one reel's renditions arrive from
// instagram.fbom20-1.fna.fbcdn.net and …fbom20-2.fna.fbcdn.net. Comparing full
// hostnames would call those unrelated, so tracks are matched on the registrable
// tail (fbcdn.net, redd.it) instead.
function cdnGroupOf(url: string): string {
  try {
    return new URL(url).hostname.split(".").slice(-2).join(".");
  } catch {
    return url;
  }
}

/**
 * URL-based classification can only guess from filenames, which works for CDNs
 * that name tracks honestly and fails completely for ones that don't — fbcdn
 * serves picture, sound and a bare DASH fragment as three identical-looking
 * `AQ…mp4` URLs. Reading each file's `hdlr` box settles it, then picture-only
 * tracks from one CDN are folded into a single asset with the sound attached.
 */
export async function reconcileTracks<T extends TrackCandidate>(
  videos: T[],
  audio: T[],
): Promise<ReconciledTracks<T>> {
  const probable = videos.filter(
    (video) => !video.isStreaming && /\.mp4(?:\?|#|$)/i.test(video.url),
  );
  if (probable.length < 2) return { videos, audio };

  const probeTargets = probable.slice(0, MAX_TRACK_PROBES);
  const probes = await mapWithConcurrency(probeTargets, 4, (video) =>
    probeMp4Track(video.url),
  );
  const tracksByUrl = new Map(
    probeTargets.map((video, i) => [video.url, probes[i]]),
  );

  const keptVideos: T[] = [];
  const promotedAudio: T[] = [];
  const unknown: T[] = [];

  for (const video of videos) {
    const tracks = tracksByUrl.get(video.url);
    if (!tracks) {
      // No verdict: either not probed, or `moov` sits past the probe window.
      unknown.push(video);
      continue;
    }
    if (tracks.kind === "audio") promotedAudio.push({ ...video });
    else keptVideos.push(video);
  }

  // A probe that found no `moov` at all on a URL sitting beside tracks that did
  // is a bare DASH fragment — unplayable alone, so it's noise, not an asset.
  const anyProbeSucceeded = probes.some(Boolean);
  const carriedUnknown = anyProbeSucceeded
    ? await (async () => {
        const verdicts = await mapWithConcurrency(
          unknown.slice(0, MAX_TRACK_PROBES),
          4,
          (video) =>
            video.isStreaming ? Promise.resolve(false) : isBareSegment(video.url),
        );
        return unknown.filter((_, i) => !verdicts[i]);
      })()
    : unknown;

  const allVideos = [...keptVideos, ...carriedUnknown];
  const allAudio = [...audio, ...promotedAudio];

  // Silent picture tracks from one host are renditions of the same video — a
  // reel arrives as a 3 MB and a 12 MB copy of identical footage. Presenting
  // them as separate finds is noise, so the biggest becomes the asset and the
  // rest become quality options on it.
  const silent = allVideos.filter((video) => tracksByUrl.get(video.url)?.silent);
  if (silent.length === 0) return { videos: allVideos, audio: allAudio };

  const group = cdnGroupOf(silent[0].url);
  if (!silent.every((video) => cdnGroupOf(video.url) === group)) {
    return { videos: allVideos, audio: allAudio };
  }

  const sizes = await mapWithConcurrency(silent, 4, (video) =>
    headSafely(video.url),
  );
  const ranked = silent
    .map((video, i) => ({ video, bytes: sizes[i]?.contentLength ?? 0 }))
    .sort((a, b) => b.bytes - a.bytes);

  const partner = allAudio.find((track) => cdnGroupOf(track.url) === group);
  const primary: T = {
    ...ranked[0].video,
    variants: ranked.map(({ video }) => video),
    ...(partner ? { audioUrl: partner.url } : {}),
  };

  return {
    videos: [primary, ...allVideos.filter((video) => !silent.includes(video))],
    audio: partner ? allAudio.filter((track) => track !== partner) : allAudio,
  };
}
