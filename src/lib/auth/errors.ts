export class AuthRequiredError extends Error {
  readonly code = "AUTH_REQUIRED";
}

export class MembershipRequiredError extends Error {
  readonly code = "MEMBERSHIP_REQUIRED";
}

export class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";
}
