import { useContext } from 'react';
import { ConfirmContext, type ConfirmFn } from '@/components/ui/ConfirmProvider';

export const useConfirm = (): ConfirmFn => useContext(ConfirmContext);
