import type { I18nKey } from '../../i18n/i18n';
import { LocalDataError, type LocalDataErrorCode } from '../storage/localDataValidation';

const errorKeys: Record<LocalDataErrorCode, I18nKey> = {
  INVALID_BACKUP: 'storage.error.invalidBackup',
  UNSUPPORTED_BACKUP_VERSION: 'storage.error.unsupportedVersion',
  INVALID_DATA: 'storage.error.invalidData',
  DUPLICATE_ID: 'storage.error.duplicateId',
  INVALID_REFERENCE: 'storage.error.invalidReference',
  STORAGE_READ_FAILED: 'storage.error.readFailed',
  STORAGE_WRITE_FAILED: 'storage.error.writeFailed',
  STORAGE_ROLLBACK_FAILED: 'storage.error.rollbackFailed',
  MIGRATION_FAILED: 'storage.error.migrationFailed',
  MIGRATION_CLEANUP_FAILED: 'storage.error.migrationCleanupFailed',
};

export function getStorageErrorMessage(
  error: unknown,
  fallback: string,
  t: (key: I18nKey) => string,
): string {
  if (error instanceof LocalDataError) return t(errorKeys[error.code]);
  return error instanceof Error ? error.message : fallback;
}
