use anchor_lang::prelude::*;

#[error_code]
pub enum MorError {
    #[msg("Previous instruction is not the expected signature precompile")]
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
    #[msg("Certificate is not an end-entity signing certificate (CA, key usage or critical extension)")]
    NotEndEntity,
    #[msg("Signer does not control the address")]
    NotController,
    #[msg("Signed seal message does not match the instruction")]
    SealMessageMismatch,
    #[msg("Seal signature submitted after its deadline")]
    SignDeadlinePassed,
    #[msg("Seal expiry is in the past or beyond the certificate")]
    InvalidExpiry,
    #[msg("Jurisdiction (country) is missing")]
    MissingJurisdiction,
    #[msg("Certificate extended key usage is not allowed for seals")]
    ForbiddenKeyPurpose,
    #[msg("Attestor key, its hash or DN hash is malformed")]
    BadAttestorKey,
}
