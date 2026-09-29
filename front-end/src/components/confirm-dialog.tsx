import { motion } from "motion/react";
import { AlertTriangle, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * A destructive action behind a confirmation step.
 *
 * The trigger is described by `label`, and the caller supplies what happens
 * on confirm. Nothing irreversible in the panels happens without passing
 * through here.
 */
type ConfirmDialogProps = {
  label: string;
  title: string;
  description: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
};

export const ConfirmDialog = ({
  label,
  title,
  description,
  onConfirm,
  className,
  disabled,
}: ConfirmDialogProps) => {
  return (
    <AlertDialog>
      <motion.div
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.94 }}
        transition={{ type: "spring", stiffness: 340, damping: 18 }}
        className={className}
      >
        <AlertDialogTrigger asChild>
          <Button
            variant="outline"
            disabled={disabled}
            className="w-full cursor-pointer gap-1.5 hover:border-destructive/40 hover:text-destructive"
          >
            <Trash2 className="size-4" />
            {label}
          </Button>
        </AlertDialogTrigger>
      </motion.div>
      <AlertDialogContent>
        <AlertDialogHeader>
          <motion.div
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: "spring", stiffness: 300, damping: 16 }}
            className="mx-auto mb-2 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive"
          >
            <AlertTriangle className="size-6" />
          </motion.div>
          <AlertDialogTitle className="text-center">
            {title}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            {description}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
