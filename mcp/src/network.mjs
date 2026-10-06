import tls from "node:tls";

// Match the OS trust store used by browsers, including locally managed CA roots.
// Keep Node's existing bundled/extra CAs and all TLS chain/hostname verification.
// This changes only this Node process; it never installs certificates on the OS.
export function configureSystemTrust(api = tls) {
  if (typeof api.getCACertificates !== "function" || typeof api.setDefaultCACertificates !== "function") return false;
  const defaults = api.getCACertificates("default");
  const system = api.getCACertificates("system");
  api.setDefaultCACertificates([...new Set([...defaults, ...system])]);
  return true;
}

configureSystemTrust();
