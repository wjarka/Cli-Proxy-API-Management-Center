import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useNotificationStore } from '@/stores';
import styles from './ConfirmationModal.module.scss';

export function ConfirmationModal() {
  const { t } = useTranslation();
  const confirmation = useNotificationStore((state) => state.confirmation);
  const hideConfirmation = useNotificationStore((state) => state.hideConfirmation);
  const setConfirmationLoading = useNotificationStore((state) => state.setConfirmationLoading);

  const { isOpen, isLoading, options } = confirmation;
  const groupId = useId();
  const [selection, setSelection] = useState<{
    choice: NonNullable<NonNullable<typeof options>['choice']>;
    id: string;
  }>();

  if (!isOpen || !options) {
    return null;
  }

  const { title, message, onCancel, confirmText, cancelText, variant = 'primary' } = options;

  const choice = options.choice;
  const selectedId =
    selection?.choice === choice && choice?.options.some(({ id }) => id === selection?.id)
      ? selection?.id
      : undefined;

  const handleConfirm = async () => {
    if (isLoading || (options.choice && !selectedId)) return;
    try {
      setConfirmationLoading(true);
      if (options.choice && selectedId) await options.onConfirm(selectedId);
      else if (!options.choice) await options.onConfirm();
      hideConfirmation();
    } catch (error) {
      console.error('Confirmation action failed:', error);
      // Optional: show error notification here if needed,
      // but usually the calling component handles specific errors.
    } finally {
      setConfirmationLoading(false);
    }
  };

  const handleCancel = () => {
    if (isLoading) {
      return;
    }
    if (onCancel) {
      onCancel();
    }
    hideConfirmation();
  };

  return (
    <Modal open={isOpen} onClose={handleCancel} title={title} closeDisabled={isLoading}>
      {typeof message === 'string' ? (
        <p style={{ margin: '1rem 0' }}>{message}</p>
      ) : (
        <div style={{ margin: '1rem 0' }}>{message}</div>
      )}
      {choice && choice.options.length > 0 && (
        <fieldset className={styles.choices} disabled={isLoading}>
          <legend>{choice.label}</legend>
          {choice.options.map((option) => (
            <label key={option.id} className={styles.option}>
              <input
                type="radio"
                name={groupId}
                checked={selectedId === option.id}
                onChange={() => setSelection({ choice, id: option.id })}
              />
              <span>
                <strong>{option.label}</strong>
                {option.details?.map((detail, index) => (
                  <span key={index} className={styles.detail}>
                    {detail}
                  </span>
                ))}
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '2rem' }}>
        <Button variant="ghost" onClick={handleCancel} disabled={isLoading}>
          {cancelText || t('common.cancel')}
        </Button>
        <Button
          variant={variant}
          onClick={handleConfirm}
          loading={isLoading}
          disabled={Boolean(choice && !selectedId)}
        >
          {confirmText || t('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
}
