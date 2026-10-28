import { useEffect, useMemo, useState } from 'react';

export interface JoinNetworkInfo {
  lanIps: string[];
  preferredLanIp: string | null;
  joinBase: string;
  uiPort: number;
  qrEnabled: boolean;
  showQrOnTv: boolean;
}

function fallbackInfo(): JoinNetworkInfo {
  return {
    lanIps: [],
    preferredLanIp: null,
    joinBase: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:43127',
    uiPort: typeof window !== 'undefined' ? Number(window.location.port) || 43127 : 43127,
    qrEnabled: true,
    showQrOnTv: true,
  };
}

export function useJoinNetwork(roomCode?: string) {
  const [info, setInfo] = useState<JoinNetworkInfo>(fallbackInfo);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/settings/network')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setInfo({ ...fallbackInfo(), ...data });
      })
      .catch(() => {
        /* keep fallback */
      });
    return () => { cancelled = true; };
  }, []);

  const joinUrl = useMemo(() => {
    if (!roomCode) return '';
    return `${info.joinBase.replace(/\/$/, '')}/join/${roomCode}`;
  }, [info, roomCode]);

  return { info, joinUrl };
}
