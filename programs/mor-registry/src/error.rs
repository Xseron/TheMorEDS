use anchor_lang::prelude::*;

#[error_code]
pub enum MorError {
    #[msg("Previous instruction is not the secp256r1 precompile")]
    PrecompileMissing,
    #[msg("Precompile instruction data is malformed or not self-contained")]
    PrecompileMalformed,
    #[msg("Signer key does not match the trust service key")]
    UntrustedKey,
    #[msg("Certificate issuer does not match the trust service")]
    IssuerMismatch,
    #[msg("Certificate signature algorithm is not ecdsa-with-SHA256")]
    BadSignatureAlgorithm,
    #[msg("Serial argument does not match the certificate")]
    SerialMismatch,
    #[msg("Certificate is not yet valid")]
    CertNotYetValid,
    #[msg("Certificate has expired")]
    CertExpired,
    #[msg("Subject public key is not P-256")]
    UnsupportedKey,
    #[msg("Subject lacks organizationName or organizationIdentifier")]
    MissingOrgAttributes,
    #[msg("Subject contains natural-person attributes")]
    NaturalPersonCert,
    #[msg("DER structure is malformed")]
    DerMalformed,
    #[msg("A string field exceeds its limit")]
    FieldTooLong,
    #[msg("Signer is not the admin")]
    Unauthorized,
    #[msg("Trust service kind is not supported")]
    UnsupportedTrustKind,
}
