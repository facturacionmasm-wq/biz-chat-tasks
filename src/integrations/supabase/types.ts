export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      appointments: {
        Row: {
          calendar_event_id: string | null
          calendar_sync_error: string | null
          calendar_sync_status: string
          call_record_id: string | null
          contact_email: string | null
          contact_name: string
          contact_phone: string | null
          created_at: string
          deleted_at: string | null
          end_at: string
          id: string
          idempotency_key: string | null
          last_sync_attempt: string | null
          notes: string | null
          service_type: string | null
          source: string | null
          start_at: string
          status: string
          sync_attempts: number
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          calendar_event_id?: string | null
          calendar_sync_error?: string | null
          calendar_sync_status?: string
          call_record_id?: string | null
          contact_email?: string | null
          contact_name: string
          contact_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          end_at: string
          id?: string
          idempotency_key?: string | null
          last_sync_attempt?: string | null
          notes?: string | null
          service_type?: string | null
          source?: string | null
          start_at: string
          status?: string
          sync_attempts?: number
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          calendar_event_id?: string | null
          calendar_sync_error?: string | null
          calendar_sync_status?: string
          call_record_id?: string | null
          contact_email?: string | null
          contact_name?: string
          contact_phone?: string | null
          created_at?: string
          deleted_at?: string | null
          end_at?: string
          id?: string
          idempotency_key?: string | null
          last_sync_attempt?: string | null
          notes?: string | null
          service_type?: string | null
          source?: string | null
          start_at?: string
          status?: string
          sync_attempts?: number
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "appointments_call_record_id_fkey"
            columns: ["call_record_id"]
            isOneToOne: false
            referencedRelation: "call_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_conversations: {
        Row: {
          created_at: string
          id: string
          tenant_id: string
          title: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          tenant_id: string
          title?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          tenant_id?: string
          title?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          metadata: Json | null
          role: string
        }
        Insert: {
          content?: string
          conversation_id: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role?: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          metadata?: Json | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "assistant_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      assistant_settings: {
        Row: {
          auto_execute: boolean
          autonomy_level: string
          created_at: string
          custom_instructions: string | null
          enabled: boolean
          id: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          auto_execute?: boolean
          autonomy_level?: string
          created_at?: string
          custom_instructions?: string | null
          enabled?: boolean
          id?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          auto_execute?: boolean
          autonomy_level?: string
          created_at?: string
          custom_instructions?: string | null
          enabled?: boolean
          id?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "assistant_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_events: {
        Row: {
          actor_id: string | null
          created_at: string
          event_type: string
          id: string
          payload: Json | null
          resource_id: string | null
          resource_type: string | null
          tenant_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          event_type: string
          id?: string
          payload?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          tenant_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          event_type?: string
          id?: string
          payload?: Json | null
          resource_id?: string | null
          resource_type?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      availability_rules: {
        Row: {
          active: boolean | null
          buffer_after: number | null
          buffer_before: number | null
          created_at: string
          day_of_week: number
          end_time: string
          id: string
          max_appointments: number | null
          service_type: string | null
          start_time: string
          tenant_id: string
          user_id: string | null
        }
        Insert: {
          active?: boolean | null
          buffer_after?: number | null
          buffer_before?: number | null
          created_at?: string
          day_of_week: number
          end_time: string
          id?: string
          max_appointments?: number | null
          service_type?: string | null
          start_time: string
          tenant_id: string
          user_id?: string | null
        }
        Update: {
          active?: boolean | null
          buffer_after?: number | null
          buffer_before?: number | null
          created_at?: string
          day_of_week?: number
          end_time?: string
          id?: string
          max_appointments?: number | null
          service_type?: string | null
          start_time?: string
          tenant_id?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "availability_rules_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_costs: {
        Row: {
          ai_tokens_used: number
          call_record_id: string
          cost_ai: number
          cost_infra: number
          cost_total: number
          cost_twilio: number
          created_at: string
          duration_minutes: number
          id: string
          margin: number
          margin_pct: number
          pricing_rule_id: string | null
          revenue_charged: number
          tenant_id: string
        }
        Insert: {
          ai_tokens_used?: number
          call_record_id: string
          cost_ai?: number
          cost_infra?: number
          cost_total?: number
          cost_twilio?: number
          created_at?: string
          duration_minutes?: number
          id?: string
          margin?: number
          margin_pct?: number
          pricing_rule_id?: string | null
          revenue_charged?: number
          tenant_id: string
        }
        Update: {
          ai_tokens_used?: number
          call_record_id?: string
          cost_ai?: number
          cost_infra?: number
          cost_total?: number
          cost_twilio?: number
          created_at?: string
          duration_minutes?: number
          id?: string
          margin?: number
          margin_pct?: number
          pricing_rule_id?: string | null
          revenue_charged?: number
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_costs_call_record_id_fkey"
            columns: ["call_record_id"]
            isOneToOne: true
            referencedRelation: "call_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_costs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_events: {
        Row: {
          call_record_id: string
          created_at: string
          event_data: Json | null
          event_type: string
          id: string
          tenant_id: string
          twilio_call_sid: string | null
        }
        Insert: {
          call_record_id: string
          created_at?: string
          event_data?: Json | null
          event_type: string
          id?: string
          tenant_id: string
          twilio_call_sid?: string | null
        }
        Update: {
          call_record_id?: string
          created_at?: string
          event_data?: Json | null
          event_type?: string
          id?: string
          tenant_id?: string
          twilio_call_sid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "call_events_call_record_id_fkey"
            columns: ["call_record_id"]
            isOneToOne: false
            referencedRelation: "call_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_jobs: {
        Row: {
          attempts: number
          call_id: string
          created_at: string
          id: string
          job_type: string
          last_error: string | null
          max_attempts: number
          result_data: Json | null
          run_after: string
          status: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          call_id: string
          created_at?: string
          id?: string
          job_type: string
          last_error?: string | null
          max_attempts?: number
          result_data?: Json | null
          run_after?: string
          status?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          call_id?: string
          created_at?: string
          id?: string
          job_type?: string
          last_error?: string | null
          max_attempts?: number
          result_data?: Json | null
          run_after?: string
          status?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_jobs_call_id_fkey"
            columns: ["call_id"]
            isOneToOne: false
            referencedRelation: "call_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "call_jobs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      call_records: {
        Row: {
          agent_user_id: string | null
          appointment_status: string
          audio_url: string | null
          channel: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          duration: number | null
          ended_at: string | null
          external_call_id: string | null
          extracted_data: Json | null
          from_number: string | null
          id: string
          recording_status: string
          started_at: string | null
          status: string
          summary_human: string | null
          summary_status: string
          summary_system: string | null
          summary_version: number | null
          tags: string[] | null
          tenant_id: string
          to_number: string | null
          transcript: string | null
          transcript_confidence: number | null
          transcript_language: string | null
          transcript_status: string
          updated_at: string
        }
        Insert: {
          agent_user_id?: string | null
          appointment_status?: string
          audio_url?: string | null
          channel?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          duration?: number | null
          ended_at?: string | null
          external_call_id?: string | null
          extracted_data?: Json | null
          from_number?: string | null
          id?: string
          recording_status?: string
          started_at?: string | null
          status?: string
          summary_human?: string | null
          summary_status?: string
          summary_system?: string | null
          summary_version?: number | null
          tags?: string[] | null
          tenant_id: string
          to_number?: string | null
          transcript?: string | null
          transcript_confidence?: number | null
          transcript_language?: string | null
          transcript_status?: string
          updated_at?: string
        }
        Update: {
          agent_user_id?: string | null
          appointment_status?: string
          audio_url?: string | null
          channel?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          duration?: number | null
          ended_at?: string | null
          external_call_id?: string | null
          extracted_data?: Json | null
          from_number?: string | null
          id?: string
          recording_status?: string
          started_at?: string | null
          status?: string
          summary_human?: string | null
          summary_status?: string
          summary_system?: string | null
          summary_version?: number | null
          tags?: string[] | null
          tenant_id?: string
          to_number?: string | null
          transcript?: string | null
          transcript_confidence?: number | null
          transcript_language?: string | null
          transcript_status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "call_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      churn_model_metrics: {
        Row: {
          accuracy_last_30d: number | null
          avg_churn_probability: number
          created_at: string
          high_risk_count: number
          id: string
          low_risk_count: number
          medium_risk_count: number
          model_version: string
          offers_generated: number
          run_date: string
          tenants_evaluated: number
        }
        Insert: {
          accuracy_last_30d?: number | null
          avg_churn_probability?: number
          created_at?: string
          high_risk_count?: number
          id?: string
          low_risk_count?: number
          medium_risk_count?: number
          model_version?: string
          offers_generated?: number
          run_date?: string
          tenants_evaluated?: number
        }
        Update: {
          accuracy_last_30d?: number | null
          avg_churn_probability?: number
          created_at?: string
          high_risk_count?: number
          id?: string
          low_risk_count?: number
          medium_risk_count?: number
          model_version?: string
          offers_generated?: number
          run_date?: string
          tenants_evaluated?: number
        }
        Relationships: []
      }
      contacts: {
        Row: {
          company: string | null
          created_at: string
          email: string | null
          id: string
          name: string | null
          notes: string | null
          phone: string
          source: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          phone: string
          source?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          company?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string | null
          notes?: string | null
          phone?: string
          source?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contacts_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expense_reminders: {
        Row: {
          created_at: string
          error_message: string | null
          expense_id: string
          id: string
          recipient_phone: string | null
          recipient_user_id: string
          reminder_date: string
          sent_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          expense_id: string
          id?: string
          recipient_phone?: string | null
          recipient_user_id: string
          reminder_date?: string
          sent_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          expense_id?: string
          id?: string
          recipient_phone?: string | null
          recipient_user_id?: string
          reminder_date?: string
          sent_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_reminders_expense_id_fkey"
            columns: ["expense_id"]
            isOneToOne: false
            referencedRelation: "expenses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expense_reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          approval_required: boolean
          approved_at: string | null
          approver_phone: string | null
          approver_user_id: string | null
          category: string | null
          concept: string | null
          created_at: string
          currency: string
          description: string | null
          document_budget_drive_file_id: string | null
          document_budget_drive_url: string | null
          document_payment_drive_file_id: string | null
          document_payment_drive_url: string | null
          drive_folder_id: string | null
          expense_date: string
          folio: string | null
          id: string
          notes: string | null
          ocr_data: Json | null
          paid_at: string | null
          payment_method: string | null
          receipt_url: string | null
          rejected_at: string | null
          rejection_reason: string | null
          source: string
          status: string
          tenant_id: string
          type: string
          updated_at: string
          user_id: string
          vendor_name: string | null
        }
        Insert: {
          amount?: number
          approval_required?: boolean
          approved_at?: string | null
          approver_phone?: string | null
          approver_user_id?: string | null
          category?: string | null
          concept?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          document_budget_drive_file_id?: string | null
          document_budget_drive_url?: string | null
          document_payment_drive_file_id?: string | null
          document_payment_drive_url?: string | null
          drive_folder_id?: string | null
          expense_date?: string
          folio?: string | null
          id?: string
          notes?: string | null
          ocr_data?: Json | null
          paid_at?: string | null
          payment_method?: string | null
          receipt_url?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          source?: string
          status?: string
          tenant_id: string
          type?: string
          updated_at?: string
          user_id: string
          vendor_name?: string | null
        }
        Update: {
          amount?: number
          approval_required?: boolean
          approved_at?: string | null
          approver_phone?: string | null
          approver_user_id?: string | null
          category?: string | null
          concept?: string | null
          created_at?: string
          currency?: string
          description?: string | null
          document_budget_drive_file_id?: string | null
          document_budget_drive_url?: string | null
          document_payment_drive_file_id?: string | null
          document_payment_drive_url?: string | null
          drive_folder_id?: string | null
          expense_date?: string
          folio?: string | null
          id?: string
          notes?: string | null
          ocr_data?: Json | null
          paid_at?: string | null
          payment_method?: string | null
          receipt_url?: string | null
          rejected_at?: string | null
          rejection_reason?: string | null
          source?: string
          status?: string
          tenant_id?: string
          type?: string
          updated_at?: string
          user_id?: string
          vendor_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "expenses_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_projections: {
        Row: {
          ai_narrative: string | null
          confidence_score: number
          created_at: string
          horizon_days: number
          id: string
          input_data: Json
          model_version: string
          opportunities: Json
          projected_calls: number
          projected_cost: number
          projected_margin: number
          projected_margin_pct: number
          projected_minutes: number
          projected_revenue: number
          projection_date: string
          risk_factors: Json
        }
        Insert: {
          ai_narrative?: string | null
          confidence_score?: number
          created_at?: string
          horizon_days: number
          id?: string
          input_data?: Json
          model_version?: string
          opportunities?: Json
          projected_calls?: number
          projected_cost?: number
          projected_margin?: number
          projected_margin_pct?: number
          projected_minutes?: number
          projected_revenue?: number
          projection_date?: string
          risk_factors?: Json
        }
        Update: {
          ai_narrative?: string | null
          confidence_score?: number
          created_at?: string
          horizon_days?: number
          id?: string
          input_data?: Json
          model_version?: string
          opportunities?: Json
          projected_calls?: number
          projected_cost?: number
          projected_margin?: number
          projected_margin_pct?: number
          projected_minutes?: number
          projected_revenue?: number
          projection_date?: string
          risk_factors?: Json
        }
        Relationships: []
      }
      fraud_detection_logs: {
        Row: {
          action_taken: string | null
          created_at: string
          details: Json
          detection_type: string
          id: string
          resolved: boolean
          resolved_at: string | null
          resolved_by: string | null
          severity: string
          tenant_id: string
        }
        Insert: {
          action_taken?: string | null
          created_at?: string
          details?: Json
          detection_type: string
          id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          tenant_id: string
        }
        Update: {
          action_taken?: string | null
          created_at?: string
          details?: Json
          detection_type?: string
          id?: string
          resolved?: boolean
          resolved_at?: string | null
          resolved_by?: string | null
          severity?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "fraud_detection_logs_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      fraud_thresholds: {
        Row: {
          action: string
          active: boolean
          created_at: string
          description: string | null
          id: string
          name: string
          severity: string
          threshold_value: number
          updated_at: string
        }
        Insert: {
          action?: string
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name: string
          severity?: string
          threshold_value: number
          updated_at?: string
        }
        Update: {
          action?: string
          active?: boolean
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          severity?: string
          threshold_value?: number
          updated_at?: string
        }
        Relationships: []
      }
      fx_rates: {
        Row: {
          base_currency: string
          created_at: string
          id: string
          rate: number
          rate_date: string
          source: string
          target_currency: string
        }
        Insert: {
          base_currency?: string
          created_at?: string
          id?: string
          rate?: number
          rate_date?: string
          source?: string
          target_currency: string
        }
        Update: {
          base_currency?: string
          created_at?: string
          id?: string
          rate?: number
          rate_date?: string
          source?: string
          target_currency?: string
        }
        Relationships: []
      }
      global_metrics_daily: {
        Row: {
          active_tenants: number
          arpu: number
          arr: number
          cac: number
          churn_rate_pct: number
          churned_tenants: number
          country_code: string
          created_at: string
          expansion_revenue: number
          gross_margin_pct: number
          id: string
          ltv_avg: number
          ltv_cac_ratio: number
          metric_date: string
          mrr: number
          net_revenue_retention_pct: number
          new_tenants: number
          region: string
          total_cost_usd: number
          total_revenue_usd: number
          total_tenants: number
        }
        Insert: {
          active_tenants?: number
          arpu?: number
          arr?: number
          cac?: number
          churn_rate_pct?: number
          churned_tenants?: number
          country_code?: string
          created_at?: string
          expansion_revenue?: number
          gross_margin_pct?: number
          id?: string
          ltv_avg?: number
          ltv_cac_ratio?: number
          metric_date?: string
          mrr?: number
          net_revenue_retention_pct?: number
          new_tenants?: number
          region?: string
          total_cost_usd?: number
          total_revenue_usd?: number
          total_tenants?: number
        }
        Update: {
          active_tenants?: number
          arpu?: number
          arr?: number
          cac?: number
          churn_rate_pct?: number
          churned_tenants?: number
          country_code?: string
          created_at?: string
          expansion_revenue?: number
          gross_margin_pct?: number
          id?: string
          ltv_avg?: number
          ltv_cac_ratio?: number
          metric_date?: string
          mrr?: number
          net_revenue_retention_pct?: number
          new_tenants?: number
          region?: string
          total_cost_usd?: number
          total_revenue_usd?: number
          total_tenants?: number
        }
        Relationships: []
      }
      global_plan_pricing: {
        Row: {
          active: boolean
          base_price: number
          country_code: string
          created_at: string
          currency: string
          id: string
          included_units: number
          overage_price: number
          plan_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          base_price?: number
          country_code?: string
          created_at?: string
          currency?: string
          id?: string
          included_units?: number
          overage_price?: number
          plan_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          base_price?: number
          country_code?: string
          created_at?: string
          currency?: string
          id?: string
          included_units?: number
          overage_price?: number
          plan_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "global_plan_pricing_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      google_calendar_tokens: {
        Row: {
          access_token: string
          calendar_id: string | null
          created_at: string
          email: string | null
          id: string
          refresh_token: string
          scopes: string[] | null
          status: string
          tenant_id: string
          token_expires_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          calendar_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          refresh_token: string
          scopes?: string[] | null
          status?: string
          tenant_id: string
          token_expires_at: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          calendar_id?: string | null
          created_at?: string
          email?: string | null
          id?: string
          refresh_token?: string
          scopes?: string[] | null
          status?: string
          tenant_id?: string
          token_expires_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "google_calendar_tokens_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      internal_messages: {
        Row: {
          attachments: Json | null
          body: string
          channel_id: string | null
          created_at: string
          id: string
          sender_id: string
          tenant_id: string
        }
        Insert: {
          attachments?: Json | null
          body: string
          channel_id?: string | null
          created_at?: string
          id?: string
          sender_id: string
          tenant_id: string
        }
        Update: {
          attachments?: Json | null
          body?: string
          channel_id?: string | null
          created_at?: string
          id?: string
          sender_id?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "internal_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_items: {
        Row: {
          active: boolean | null
          author_id: string | null
          category: string | null
          content: string
          created_at: string
          deleted_at: string | null
          id: string
          tags: string[] | null
          tenant_id: string
          title: string
          updated_at: string
          version: number | null
          visibility: string
        }
        Insert: {
          active?: boolean | null
          author_id?: string | null
          category?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          tags?: string[] | null
          tenant_id: string
          title: string
          updated_at?: string
          version?: number | null
          visibility?: string
        }
        Update: {
          active?: boolean | null
          author_id?: string | null
          category?: string | null
          content?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          tags?: string[] | null
          tenant_id?: string
          title?: string
          updated_at?: string
          version?: number | null
          visibility?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_items_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      margin_metrics: {
        Row: {
          cost_mtd: number
          created_at: string
          id: string
          margin_mtd: number
          margin_pct_mtd: number
          metric_date: string
          projected_cost_eom: number
          projected_margin_eom: number
          projected_revenue_eom: number
          revenue_mtd: number
          risk_level: string
          tenant_id: string
        }
        Insert: {
          cost_mtd?: number
          created_at?: string
          id?: string
          margin_mtd?: number
          margin_pct_mtd?: number
          metric_date?: string
          projected_cost_eom?: number
          projected_margin_eom?: number
          projected_revenue_eom?: number
          revenue_mtd?: number
          risk_level?: string
          tenant_id: string
        }
        Update: {
          cost_mtd?: number
          created_at?: string
          id?: string
          margin_mtd?: number
          margin_pct_mtd?: number
          metric_date?: string
          projected_cost_eom?: number
          projected_margin_eom?: number
          projected_revenue_eom?: number
          revenue_mtd?: number
          risk_level?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "margin_metrics_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      message_read_receipts: {
        Row: {
          id: string
          message_id: string
          read_at: string
          user_id: string
        }
        Insert: {
          id?: string
          message_id: string
          read_at?: string
          user_id: string
        }
        Update: {
          id?: string
          message_id?: string
          read_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "message_read_receipts_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "internal_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      otp_challenges: {
        Row: {
          attempts: number | null
          code_hash: string
          created_at: string
          expires_at: string
          id: string
          max_attempts: number | null
          phone: string
          tenant_id: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number | null
          code_hash: string
          created_at?: string
          expires_at: string
          id?: string
          max_attempts?: number | null
          phone: string
          tenant_id: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number | null
          code_hash?: string
          created_at?: string
          expires_at?: string
          id?: string
          max_attempts?: number | null
          phone?: string
          tenant_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "otp_challenges_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plan_change_history: {
        Row: {
          applied_by: string
          change_reason: string | null
          change_type: string
          created_at: string
          evaluation_id: string | null
          id: string
          new_plan_slug: string
          old_plan_slug: string | null
          stripe_subscription_id: string | null
          tenant_id: string
        }
        Insert: {
          applied_by?: string
          change_reason?: string | null
          change_type?: string
          created_at?: string
          evaluation_id?: string | null
          id?: string
          new_plan_slug: string
          old_plan_slug?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
        }
        Update: {
          applied_by?: string
          change_reason?: string | null
          change_type?: string
          created_at?: string
          evaluation_id?: string | null
          id?: string
          new_plan_slug?: string
          old_plan_slug?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plan_change_history_evaluation_id_fkey"
            columns: ["evaluation_id"]
            isOneToOne: false
            referencedRelation: "pricing_evaluations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "plan_change_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_evaluations: {
        Row: {
          action_applied: boolean
          action_reason: string | null
          applied_at: string | null
          avg_margin_pct_3m: number
          avg_monthly_calls_3m: number
          avg_monthly_cost_3m: number
          avg_monthly_minutes_3m: number
          avg_monthly_revenue_3m: number
          created_at: string
          current_plan_slug: string | null
          evaluation_date: string
          growth_rate_pct: number
          id: string
          new_markup_pct: number | null
          new_per_minute_rate: number | null
          old_markup_pct: number | null
          old_per_minute_rate: number | null
          recommended_action: string
          recommended_plan_slug: string | null
          tenant_id: string
          usage_tier: string
        }
        Insert: {
          action_applied?: boolean
          action_reason?: string | null
          applied_at?: string | null
          avg_margin_pct_3m?: number
          avg_monthly_calls_3m?: number
          avg_monthly_cost_3m?: number
          avg_monthly_minutes_3m?: number
          avg_monthly_revenue_3m?: number
          created_at?: string
          current_plan_slug?: string | null
          evaluation_date?: string
          growth_rate_pct?: number
          id?: string
          new_markup_pct?: number | null
          new_per_minute_rate?: number | null
          old_markup_pct?: number | null
          old_per_minute_rate?: number | null
          recommended_action?: string
          recommended_plan_slug?: string | null
          tenant_id: string
          usage_tier?: string
        }
        Update: {
          action_applied?: boolean
          action_reason?: string | null
          applied_at?: string | null
          avg_margin_pct_3m?: number
          avg_monthly_calls_3m?: number
          avg_monthly_cost_3m?: number
          avg_monthly_minutes_3m?: number
          avg_monthly_revenue_3m?: number
          created_at?: string
          current_plan_slug?: string | null
          evaluation_date?: string
          growth_rate_pct?: number
          id?: string
          new_markup_pct?: number | null
          new_per_minute_rate?: number | null
          old_markup_pct?: number | null
          old_per_minute_rate?: number | null
          recommended_action?: string
          recommended_plan_slug?: string | null
          tenant_id?: string
          usage_tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "pricing_evaluations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      pricing_rules: {
        Row: {
          active: boolean
          base_rate: number
          conditions: Json | null
          created_at: string
          description: string | null
          id: string
          markup_pct: number
          min_charge: number
          name: string
          priority: number
          rule_type: string
          updated_at: string
          volume_tiers: Json | null
        }
        Insert: {
          active?: boolean
          base_rate?: number
          conditions?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          markup_pct?: number
          min_charge?: number
          name: string
          priority?: number
          rule_type?: string
          updated_at?: string
          volume_tiers?: Json | null
        }
        Update: {
          active?: boolean
          base_rate?: number
          conditions?: Json | null
          created_at?: string
          description?: string | null
          id?: string
          markup_pct?: number
          min_charge?: number
          name?: string
          priority?: number
          rule_type?: string
          updated_at?: string
          volume_tiers?: Json | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          onboarding_completed: boolean | null
          phone: string | null
          pin_hash: string | null
          status: string
          tenant_id: string
          updated_at: string
          user_id: string
          whatsapp_number: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          onboarding_completed?: boolean | null
          phone?: string | null
          pin_hash?: string | null
          status?: string
          tenant_id: string
          updated_at?: string
          user_id: string
          whatsapp_number?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          onboarding_completed?: boolean | null
          phone?: string | null
          pin_hash?: string | null
          status?: string
          tenant_id?: string
          updated_at?: string
          user_id?: string
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          tenant_id: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          tenant_id: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      realtime_margin_state: {
        Row: {
          avg_cost_per_minute: number
          avg_revenue_per_minute: number
          current_month_calls: number
          current_month_cost: number
          current_month_margin: number
          current_month_margin_pct: number
          current_month_minutes: number
          current_month_revenue: number
          dynamic_markup_pct: number
          id: string
          last_call_at: string | null
          margin_alert_active: boolean
          tenant_id: string
          updated_at: string
        }
        Insert: {
          avg_cost_per_minute?: number
          avg_revenue_per_minute?: number
          current_month_calls?: number
          current_month_cost?: number
          current_month_margin?: number
          current_month_margin_pct?: number
          current_month_minutes?: number
          current_month_revenue?: number
          dynamic_markup_pct?: number
          id?: string
          last_call_at?: string | null
          margin_alert_active?: boolean
          tenant_id: string
          updated_at?: string
        }
        Update: {
          avg_cost_per_minute?: number
          avg_revenue_per_minute?: number
          current_month_calls?: number
          current_month_cost?: number
          current_month_margin?: number
          current_month_margin_pct?: number
          current_month_minutes?: number
          current_month_revenue?: number
          dynamic_markup_pct?: number
          id?: string
          last_call_at?: string | null
          margin_alert_active?: boolean
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "realtime_margin_state_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      regional_margin_targets: {
        Row: {
          active: boolean
          country_risk_multiplier: number
          created_at: string
          id: string
          max_price_change_pct: number
          region: string
          target_gross_margin_pct: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          country_risk_multiplier?: number
          created_at?: string
          id?: string
          max_price_change_pct?: number
          region: string
          target_gross_margin_pct?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          country_risk_multiplier?: number
          created_at?: string
          id?: string
          max_price_change_pct?: number
          region?: string
          target_gross_margin_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          max_retries: number
          message: string
          remind_at: string
          retry_count: number
          sent_at: string | null
          source: string | null
          status: string
          tenant_id: string
          timezone: string
          user_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          max_retries?: number
          message: string
          remind_at: string
          retry_count?: number
          sent_at?: string | null
          source?: string | null
          status?: string
          tenant_id: string
          timezone?: string
          user_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          max_retries?: number
          message?: string
          remind_at?: string
          retry_count?: number
          sent_at?: string | null
          source?: string | null
          status?: string
          tenant_id?: string
          timezone?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      retention_offers: {
        Row: {
          accepted_at: string | null
          created_at: string
          description: string | null
          discount_pct: number | null
          duration_days: number | null
          estimated_margin_impact: number | null
          expires_at: string | null
          id: string
          offer_type: string
          status: string
          tenant_id: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string
          description?: string | null
          discount_pct?: number | null
          duration_days?: number | null
          estimated_margin_impact?: number | null
          expires_at?: string | null
          id?: string
          offer_type: string
          status?: string
          tenant_id: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string
          description?: string | null
          discount_pct?: number | null
          duration_days?: number | null
          estimated_margin_impact?: number | null
          expires_at?: string | null
          id?: string
          offer_type?: string
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "retention_offers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      service_packages: {
        Row: {
          active: boolean
          created_at: string
          currency: string
          description: string | null
          id: string
          name: string
          popular: boolean
          price: number
          service_type: string
          sort_order: number
          unit_label: string
          units: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          name: string
          popular?: boolean
          price?: number
          service_type?: string
          sort_order?: number
          unit_label?: string
          units?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          currency?: string
          description?: string | null
          id?: string
          name?: string
          popular?: boolean
          price?: number
          service_type?: string
          sort_order?: number
          unit_label?: string
          units?: number
          updated_at?: string
        }
        Relationships: []
      }
      shared_credentials: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          password_encrypted: string
          platform_name: string
          tenant_id: string
          updated_at: string
          username: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          password_encrypted: string
          platform_name: string
          tenant_id: string
          updated_at?: string
          username: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          password_encrypted?: string
          platform_name?: string
          tenant_id?: string
          updated_at?: string
          username?: string
        }
        Relationships: [
          {
            foreignKeyName: "shared_credentials_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_customers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          metadata: Json | null
          name: string | null
          stripe_base_item_id: string | null
          stripe_customer_id: string
          stripe_metered_item_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          stripe_base_item_id?: string | null
          stripe_customer_id: string
          stripe_metered_item_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          metadata?: Json | null
          name?: string | null
          stripe_base_item_id?: string | null
          stripe_customer_id?: string
          stripe_metered_item_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_customers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_usage_records: {
        Row: {
          created_at: string
          error_message: string | null
          id: string
          period_end: string
          period_start: string
          quantity: number
          reported_at: string | null
          status: string
          stripe_subscription_item_id: string
          stripe_usage_record_id: string | null
          tenant_id: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          id?: string
          period_end: string
          period_start: string
          quantity?: number
          reported_at?: string | null
          status?: string
          stripe_subscription_item_id: string
          stripe_usage_record_id?: string | null
          tenant_id: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          id?: string
          period_end?: string
          period_start?: string
          quantity?: number
          reported_at?: string | null
          status?: string
          stripe_subscription_item_id?: string
          stripe_usage_record_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "stripe_usage_records_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      subscription_plans: {
        Row: {
          active: boolean | null
          created_at: string | null
          features: Json | null
          id: string
          limits: Json | null
          name: string
          price_monthly: number
          price_yearly: number | null
          slug: string
          sort_order: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          features?: Json | null
          id?: string
          limits?: Json | null
          name: string
          price_monthly?: number
          price_yearly?: number | null
          slug: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          features?: Json | null
          id?: string
          limits?: Json | null
          name?: string
          price_monthly?: number
          price_yearly?: number | null
          slug?: string
          sort_order?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      tenant_churn_scores: {
        Row: {
          calculated_at: string
          churn_probability: number
          factors: Json
          id: string
          model_version: string
          risk_category: string
          tenant_id: string
        }
        Insert: {
          calculated_at?: string
          churn_probability?: number
          factors?: Json
          id?: string
          model_version?: string
          risk_category?: string
          tenant_id: string
        }
        Update: {
          calculated_at?: string
          churn_probability?: number
          factors?: Json
          id?: string
          model_version?: string
          risk_category?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_churn_scores_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_drive_settings: {
        Row: {
          created_at: string
          created_by: string | null
          drive_provider: string
          drive_root_folder_id: string | null
          drive_root_folder_url: string | null
          drive_structure_version: number
          tenant_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          drive_provider?: string
          drive_root_folder_id?: string | null
          drive_root_folder_url?: string | null
          drive_structure_version?: number
          tenant_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          drive_provider?: string
          drive_root_folder_id?: string | null
          drive_root_folder_url?: string | null
          drive_structure_version?: number
          tenant_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_drive_settings_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_ltv_estimates: {
        Row: {
          avg_monthly_revenue: number
          calculated_at: string
          churn_probability: number
          country_risk_factor: number
          created_at: string
          estimated_lifetime_months: number
          estimated_ltv_local: number
          estimated_ltv_usd: number
          fx_instability_factor: number
          id: string
          model_version: string
          tenant_id: string
        }
        Insert: {
          avg_monthly_revenue?: number
          calculated_at?: string
          churn_probability?: number
          country_risk_factor?: number
          created_at?: string
          estimated_lifetime_months?: number
          estimated_ltv_local?: number
          estimated_ltv_usd?: number
          fx_instability_factor?: number
          id?: string
          model_version?: string
          tenant_id: string
        }
        Update: {
          avg_monthly_revenue?: number
          calculated_at?: string
          churn_probability?: number
          country_risk_factor?: number
          created_at?: string
          estimated_lifetime_months?: number
          estimated_ltv_local?: number
          estimated_ltv_usd?: number
          fx_instability_factor?: number
          id?: string
          model_version?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_ltv_estimates_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_offer_history: {
        Row: {
          churn_score_at_time: number | null
          created_at: string
          id: string
          impact_revenue_30d: number | null
          margin_at_time: number | null
          offer_id: string | null
          offer_type: string
          response_action: string | null
          response_at: string | null
          status: string
          tenant_id: string
        }
        Insert: {
          churn_score_at_time?: number | null
          created_at?: string
          id?: string
          impact_revenue_30d?: number | null
          margin_at_time?: number | null
          offer_id?: string | null
          offer_type: string
          response_action?: string | null
          response_at?: string | null
          status?: string
          tenant_id: string
        }
        Update: {
          churn_score_at_time?: number | null
          created_at?: string
          id?: string
          impact_revenue_30d?: number | null
          margin_at_time?: number | null
          offer_id?: string | null
          offer_type?: string
          response_action?: string | null
          response_at?: string | null
          status?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_offer_history_offer_id_fkey"
            columns: ["offer_id"]
            isOneToOne: false
            referencedRelation: "retention_offers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_offer_history_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_package_balances: {
        Row: {
          created_at: string
          expires_at: string | null
          id: string
          package_id: string
          purchased_at: string
          service_type: string
          status: string
          stripe_payment_intent_id: string | null
          tenant_id: string
          units_purchased: number
          units_remaining: number | null
          units_used: number
        }
        Insert: {
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id: string
          purchased_at?: string
          service_type: string
          status?: string
          stripe_payment_intent_id?: string | null
          tenant_id: string
          units_purchased?: number
          units_remaining?: number | null
          units_used?: number
        }
        Update: {
          created_at?: string
          expires_at?: string | null
          id?: string
          package_id?: string
          purchased_at?: string
          service_type?: string
          status?: string
          stripe_payment_intent_id?: string | null
          tenant_id?: string
          units_purchased?: number
          units_remaining?: number | null
          units_used?: number
        }
        Relationships: [
          {
            foreignKeyName: "tenant_package_balances_package_id_fkey"
            columns: ["package_id"]
            isOneToOne: false
            referencedRelation: "service_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_package_balances_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_phone_numbers: {
        Row: {
          active: boolean
          created_at: string
          id: string
          label: string | null
          phone_e164: string
          provider: string
          tenant_id: string
          twilio_subaccount_sid: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          phone_e164: string
          provider?: string
          tenant_id: string
          twilio_subaccount_sid?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          phone_e164?: string
          provider?: string
          tenant_id?: string
          twilio_subaccount_sid?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_phone_numbers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_pricing_adjustments: {
        Row: {
          active: boolean
          adjustment_type: string
          adjustment_value: number
          applied_by: string | null
          created_at: string
          id: string
          pricing_rule_id: string | null
          reason: string | null
          tenant_id: string
          valid_from: string
          valid_until: string | null
        }
        Insert: {
          active?: boolean
          adjustment_type?: string
          adjustment_value?: number
          applied_by?: string | null
          created_at?: string
          id?: string
          pricing_rule_id?: string | null
          reason?: string | null
          tenant_id: string
          valid_from?: string
          valid_until?: string | null
        }
        Update: {
          active?: boolean
          adjustment_type?: string
          adjustment_value?: number
          applied_by?: string | null
          created_at?: string
          id?: string
          pricing_rule_id?: string | null
          reason?: string | null
          tenant_id?: string
          valid_from?: string
          valid_until?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_pricing_adjustments_pricing_rule_id_fkey"
            columns: ["pricing_rule_id"]
            isOneToOne: false
            referencedRelation: "pricing_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_pricing_adjustments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_rate_limits: {
        Row: {
          blocked_at: string | null
          blocked_reason: string | null
          blocked_until: string | null
          calls_last_day: number
          calls_last_day_reset_at: string
          calls_last_hour: number
          calls_last_hour_reset_at: string
          id: string
          is_blocked: boolean
          max_calls_per_day: number
          max_calls_per_hour: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          blocked_at?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          calls_last_day?: number
          calls_last_day_reset_at?: string
          calls_last_hour?: number
          calls_last_hour_reset_at?: string
          id?: string
          is_blocked?: boolean
          max_calls_per_day?: number
          max_calls_per_hour?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          blocked_at?: string | null
          blocked_reason?: string | null
          blocked_until?: string | null
          calls_last_day?: number
          calls_last_day_reset_at?: string
          calls_last_hour?: number
          calls_last_hour_reset_at?: string
          id?: string
          is_blocked?: boolean
          max_calls_per_day?: number
          max_calls_per_hour?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_rate_limits_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_subscriptions: {
        Row: {
          canceled_at: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          id: string
          plan_id: string
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tenant_id: string
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          plan_id?: string
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tenant_id?: string
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_subscriptions_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: true
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_usage_monthly: {
        Row: {
          cost_ai: number
          cost_infra: number
          cost_total: number
          cost_twilio: number
          created_at: string
          id: string
          margin: number
          margin_pct: number
          period_end: string
          period_start: string
          revenue: number
          tenant_id: string
          total_ai_tokens: number
          total_calls: number
          total_minutes: number
          updated_at: string
        }
        Insert: {
          cost_ai?: number
          cost_infra?: number
          cost_total?: number
          cost_twilio?: number
          created_at?: string
          id?: string
          margin?: number
          margin_pct?: number
          period_end: string
          period_start: string
          revenue?: number
          tenant_id: string
          total_ai_tokens?: number
          total_calls?: number
          total_minutes?: number
          updated_at?: string
        }
        Update: {
          cost_ai?: number
          cost_infra?: number
          cost_total?: number
          cost_twilio?: number
          created_at?: string
          id?: string
          margin?: number
          margin_pct?: number
          period_end?: string
          period_start?: string
          revenue?: number
          tenant_id?: string
          total_ai_tokens?: number
          total_calls?: number
          total_minutes?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_usage_monthly_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          country_code: string
          created_at: string
          currency: string
          elevenlabs_config: Json | null
          google_calendar_config: Json | null
          id: string
          name: string
          notification_rules: Json | null
          region: string
          settings_json: Json | null
          timezone: string
          updated_at: string
          whatsapp_config: Json | null
        }
        Insert: {
          country_code?: string
          created_at?: string
          currency?: string
          elevenlabs_config?: Json | null
          google_calendar_config?: Json | null
          id?: string
          name: string
          notification_rules?: Json | null
          region?: string
          settings_json?: Json | null
          timezone?: string
          updated_at?: string
          whatsapp_config?: Json | null
        }
        Update: {
          country_code?: string
          created_at?: string
          currency?: string
          elevenlabs_config?: Json | null
          google_calendar_config?: Json | null
          id?: string
          name?: string
          notification_rules?: Json | null
          region?: string
          settings_json?: Json | null
          timezone?: string
          updated_at?: string
          whatsapp_config?: Json | null
        }
        Relationships: []
      }
      transfer_notifications: {
        Row: {
          call_record_id: string | null
          caller_phone: string | null
          created_at: string
          id: string
          read_at: string | null
          summary: string | null
          target_name: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Insert: {
          call_record_id?: string | null
          caller_phone?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          summary?: string | null
          target_name?: string | null
          tenant_id: string
          title: string
          user_id: string
        }
        Update: {
          call_record_id?: string | null
          caller_phone?: string | null
          created_at?: string
          id?: string
          read_at?: string | null
          summary?: string | null
          target_name?: string | null
          tenant_id?: string
          title?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transfer_notifications_call_record_id_fkey"
            columns: ["call_record_id"]
            isOneToOne: false
            referencedRelation: "call_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transfer_notifications_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_costs_reconciled: {
        Row: {
          created_at: string
          currency: string
          fx_rate_used: number
          id: string
          margin_local: number
          margin_pct: number
          margin_usd: number
          period_end: string
          period_start: string
          real_cost_local_currency: number
          real_cost_usd: number
          reconciled_at: string | null
          reconciliation_status: string
          region: string
          revenue_local_currency: number
          revenue_usd: number
          tenant_id: string
          total_events: number
          total_units: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          currency?: string
          fx_rate_used?: number
          id?: string
          margin_local?: number
          margin_pct?: number
          margin_usd?: number
          period_end: string
          period_start: string
          real_cost_local_currency?: number
          real_cost_usd?: number
          reconciled_at?: string | null
          reconciliation_status?: string
          region?: string
          revenue_local_currency?: number
          revenue_usd?: number
          tenant_id: string
          total_events?: number
          total_units?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          currency?: string
          fx_rate_used?: number
          id?: string
          margin_local?: number
          margin_pct?: number
          margin_usd?: number
          period_end?: string
          period_start?: string
          real_cost_local_currency?: number
          real_cost_usd?: number
          reconciled_at?: string | null
          reconciliation_status?: string
          region?: string
          revenue_local_currency?: number
          revenue_usd?: number
          tenant_id?: string
          total_events?: number
          total_units?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_costs_reconciled_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          permissions_json: Json | null
          role: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permissions_json?: Json | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permissions_json?: Json | null
          role?: Database["public"]["Enums"]["app_role"]
          tenant_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      volume_tiers: {
        Row: {
          active: boolean
          created_at: string
          discount_pct: number
          id: string
          markup_pct: number
          max_minutes: number | null
          min_minutes: number
          name: string
          per_minute_rate: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          discount_pct?: number
          id?: string
          markup_pct?: number
          max_minutes?: number | null
          min_minutes?: number
          name: string
          per_minute_rate: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          discount_pct?: number
          id?: string
          markup_pct?: number
          max_minutes?: number | null
          min_minutes?: number
          name?: string
          per_minute_rate?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      whatsapp_conversations: {
        Row: {
          assigned_user_id: string | null
          bot_context: Json | null
          bot_state: string | null
          contact_name: string | null
          contact_phone: string
          created_at: string
          id: string
          last_message_at: string | null
          notes: string | null
          status: string
          tags: string[] | null
          tenant_id: string
          updated_at: string
          verified_user_id: string | null
        }
        Insert: {
          assigned_user_id?: string | null
          bot_context?: Json | null
          bot_state?: string | null
          contact_name?: string | null
          contact_phone: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          notes?: string | null
          status?: string
          tags?: string[] | null
          tenant_id: string
          updated_at?: string
          verified_user_id?: string | null
        }
        Update: {
          assigned_user_id?: string | null
          bot_context?: Json | null
          bot_state?: string | null
          contact_name?: string | null
          contact_phone?: string
          created_at?: string
          id?: string
          last_message_at?: string | null
          notes?: string | null
          status?: string
          tags?: string[] | null
          tenant_id?: string
          updated_at?: string
          verified_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_conversations_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          direction: string
          id: string
          media_url: string | null
          metadata: Json | null
          status: string
          template_id: string | null
          tenant_id: string
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          direction?: string
          id?: string
          media_url?: string | null
          metadata?: Json | null
          status?: string
          template_id?: string | null
          tenant_id: string
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          direction?: string
          id?: string
          media_url?: string | null
          metadata?: Json | null
          status?: string
          template_id?: string | null
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_messages_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_usage_events: {
        Row: {
          billing_status: string
          created_at: string
          event_type: string
          id: string
          metadata: Json | null
          occurred_at: string
          provider: string
          provider_message_id: string | null
          region: string
          tenant_id: string
          units: number
        }
        Insert: {
          billing_status?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          provider?: string
          provider_message_id?: string | null
          region?: string
          tenant_id: string
          units?: number
        }
        Update: {
          billing_status?: string
          created_at?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          occurred_at?: string
          provider?: string
          provider_message_id?: string | null
          region?: string
          tenant_id?: string
          units?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_usage_events_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      profiles_safe: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string | null
          id: string | null
          name: string | null
          phone: string | null
          status: string | null
          tenant_id: string | null
          updated_at: string | null
          user_id: string | null
          whatsapp_number: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          name?: string | null
          phone?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          whatsapp_number?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string | null
          id?: string | null
          name?: string | null
          phone?: string | null
          status?: string | null
          tenant_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          whatsapp_number?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      block_expired_trials: { Args: never; Returns: undefined }
      calculate_next_retry: {
        Args: { _base_delay_minutes?: number; _retry_count: number }
        Returns: string
      }
      get_tenant_branding: { Args: { _tenant_id: string }; Returns: Json }
      get_tenant_subscription_status: {
        Args: { _user_id: string }
        Returns: Json
      }
      get_user_tenant_id: { Args: { _user_id: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      has_tenant_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _tenant_id: string
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "owner"
        | "admin"
        | "staff"
        | "partner"
        | "guest"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["super_admin", "owner", "admin", "staff", "partner", "guest"],
    },
  },
} as const
