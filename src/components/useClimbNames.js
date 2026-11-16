/**
 * Noms des montées : le navigateur (rapide, toujours disponible) ET le dossier
 * de sorties (`climbs.json`, qui suit l'utilisateur d'un appareil à l'autre).
 * Au chargement, les deux sont fusionnés ; à chaque nom saisi, les deux sont
 * mis à jour.
 */
import { useCallback, useEffect, useState } from "react";
import {
  STORAGE_KEY, loadClimbNames, saveClimbName, saveStravaLinks, mergeClimbNames, readClimbNamesFile, writeClimbNamesFile,
} from "../lib/climbs/climbNames.js";

/** @param {FileSystemDirectoryHandle|null} rootHandle */
export function useClimbNames(rootHandle) {
  const [names, setNames] = useState(() => loadClimbNames());

  useEffect(() => {
    if (!rootHandle) return undefined;
    let cancelled = false;
    readClimbNamesFile(rootHandle).then((fromFile) => {
      if (cancelled || fromFile.length === 0) return;
      setNames((local) => {
        const merged = mergeClimbNames(local, fromFile);
        try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch { /* stockage indisponible */ }
        return merged;
      });
    });
    return () => { cancelled = true; };
  }, [rootHandle]);

  const rename = useCallback((group, rawName) => {
    const next = saveClimbName(names, group, rawName);
    setNames(next);
    writeClimbNamesFile(rootHandle, next); // meilleur effort : le nom reste valable dans le navigateur
  }, [names, rootHandle]);

  const linkStrava = useCallback((links) => {
    if (links.length === 0) return;
    const next = saveStravaLinks(names, links);
    setNames(next);
    writeClimbNamesFile(rootHandle, next);
  }, [names, rootHandle]);

  return { names, rename, linkStrava };
}
