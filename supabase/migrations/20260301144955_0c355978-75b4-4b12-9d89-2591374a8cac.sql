-- Allow users to delete their own reminders
CREATE POLICY "Users can delete own reminders"
  ON public.reminders FOR DELETE
  USING (user_id = auth.uid());

-- Allow users to update their own reminders (for resend)
CREATE POLICY "Users can update own reminders"
  ON public.reminders FOR UPDATE
  USING (user_id = auth.uid());