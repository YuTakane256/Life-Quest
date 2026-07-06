export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      battle_attempts: {
        Row: {
          created_at: string
          enemy_snapshot: Json
          id: string
          outcome: string | null
          player_snapshot: Json
          resolved_at: string | null
          stage: number
          status: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          enemy_snapshot: Json
          id?: string
          outcome?: string | null
          player_snapshot: Json
          resolved_at?: string | null
          stage: number
          status?: string
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          created_at?: string
          enemy_snapshot?: Json
          id?: string
          outcome?: string | null
          player_snapshot?: Json
          resolved_at?: string | null
          stage?: number
          status?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      characters: {
        Row: {
          avatar: string
          battle_unlocked: boolean
          created_at: string
          current_stage: number
          debuff_active: boolean
          debuff_expires_at: string | null
          gacha_count: number
          max_cleared_stage: number
          name: string
          total_xp: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          avatar?: string
          battle_unlocked?: boolean
          created_at?: string
          current_stage?: number
          debuff_active?: boolean
          debuff_expires_at?: string | null
          gacha_count?: number
          max_cleared_stage?: number
          name?: string
          total_xp?: number
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          avatar?: string
          battle_unlocked?: boolean
          created_at?: string
          current_stage?: number
          debuff_active?: boolean
          debuff_expires_at?: string | null
          gacha_count?: number
          max_cleared_stage?: number
          name?: string
          total_xp?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      chests: {
        Row: {
          chest_type: string
          created_at: string
          deleted_at: string | null
          id: string
          is_starter_character: boolean
          label: string
          opened: boolean
          opened_item_id: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          chest_type: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_starter_character?: boolean
          label?: string
          opened?: boolean
          opened_item_id?: string | null
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          chest_type?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_starter_character?: boolean
          label?: string
          opened?: boolean
          opened_item_id?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      habit_logs: {
        Row: {
          completed: boolean
          created_at: string
          date: string
          deleted_at: string | null
          habit_id: string
          memo: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          completed?: boolean
          created_at?: string
          date: string
          deleted_at?: string | null
          habit_id: string
          memo?: string
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          completed?: boolean
          created_at?: string
          date?: string
          deleted_at?: string | null
          habit_id?: string
          memo?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "habit_logs_habit_id_user_id_fkey"
            columns: ["habit_id", "user_id"]
            isOneToOne: false
            referencedRelation: "habits"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      habits: {
        Row: {
          category_id: string
          client_id: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          category_id?: string
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          category_id?: string
          client_id?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      idempotency_keys: {
        Row: {
          created_at: string
          key: string
          operation: string
          result: Json | null
          status: string
          user_id: string
        }
        Insert: {
          created_at?: string
          key: string
          operation: string
          result?: Json | null
          status?: string
          user_id: string
        }
        Update: {
          created_at?: string
          key?: string
          operation?: string
          result?: Json | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      inventory_items: {
        Row: {
          created_at: string
          deleted_at: string | null
          equipped: boolean
          id: string
          template_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          equipped?: boolean
          id?: string
          template_id: string
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          equipped?: boolean
          id?: string
          template_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      profiles: {
        Row: {
          active_title: string | null
          avatar: string | null
          created_at: string
          display_name: string | null
          imported_at: string | null
          migrated_from: string | null
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          active_title?: string | null
          avatar?: string | null
          created_at?: string
          display_name?: string | null
          imported_at?: string | null
          migrated_from?: string | null
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          active_title?: string | null
          avatar?: string | null
          created_at?: string
          display_name?: string | null
          imported_at?: string | null
          migrated_from?: string | null
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      rest_days: {
        Row: {
          created_at: string
          date: string
          deleted_at: string | null
          is_rest: boolean
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          date: string
          deleted_at?: string | null
          is_rest?: boolean
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          created_at?: string
          date?: string
          deleted_at?: string | null
          is_rest?: boolean
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      reward_transactions: {
        Row: {
          created_at: string
          id: string
          kind: string
          source_id: string
          user_id: string
          xp_delta: number
        }
        Insert: {
          created_at?: string
          id?: string
          kind: string
          source_id: string
          user_id: string
          xp_delta: number
        }
        Update: {
          created_at?: string
          id?: string
          kind?: string
          source_id?: string
          user_id?: string
          xp_delta?: number
        }
        Relationships: []
      }
      stats_daily: {
        Row: {
          all_habits_complete: boolean
          created_at: string
          date: string
          deleted_at: string | null
          habit_count: number
          task_xp: number
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          all_habits_complete?: boolean
          created_at?: string
          date: string
          deleted_at?: string | null
          habit_count?: number
          task_xp?: number
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          all_habits_complete?: boolean
          created_at?: string
          date?: string
          deleted_at?: string | null
          habit_count?: number
          task_xp?: number
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      subtasks: {
        Row: {
          client_id: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          task_id: string
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          client_id?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          task_id: string
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          client_id?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          task_id?: string
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "subtasks_task_id_user_id_fkey"
            columns: ["task_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tasks"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sync_versions: {
        Row: {
          current_version: number
          user_id: string
        }
        Insert: {
          current_version?: number
          user_id: string
        }
        Update: {
          current_version?: number
          user_id?: string
        }
        Relationships: []
      }
      tasks: {
        Row: {
          client_id: string | null
          completed: boolean
          completed_at: string | null
          created_at: string
          deleted_at: string | null
          due_date: string | null
          id: string
          name: string
          priority: string
          recurrence: string
          tags: string[]
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          client_id?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string | null
          id?: string
          name: string
          priority?: string
          recurrence?: string
          tags?: string[]
          updated_at?: string
          user_id: string
          version: number
        }
        Update: {
          client_id?: string | null
          completed?: boolean
          completed_at?: string | null
          created_at?: string
          deleted_at?: string | null
          due_date?: string | null
          id?: string
          name?: string
          priority?: string
          recurrence?: string
          tags?: string[]
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          created_at: string
          settings: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          created_at?: string
          settings?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          created_at?: string
          settings?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assert_import_payload_size: {
        Args: { p_payload: Json }
        Returns: undefined
      }
      claim_habit_bonus_apply: {
        Args: { p_date: string; p_key: string; p_user_id: string; p_xp: number }
        Returns: Json
      }
      complete_subtask_apply: {
        Args: {
          p_chest: Json
          p_key: string
          p_parent_chest: Json
          p_parent_xp: number
          p_subtask_id: string
          p_user_id: string
          p_xp: number
        }
        Returns: Json
      }
      complete_task_apply: {
        Args: {
          p_chest: Json
          p_key: string
          p_next_task: Json
          p_task_id: string
          p_user_id: string
          p_xp: number
        }
        Returns: Json
      }
      delete_subtask: { Args: { p_id: string; p_key: string }; Returns: Json }
      delete_task: { Args: { p_id: string; p_key: string }; Returns: Json }
      finish_idempotency_key: {
        Args: { p_key: string; p_result: Json; p_user_id: string }
        Returns: undefined
      }
      import_collections: {
        Args: { p_payload: Json; p_user_id: string; p_version: number }
        Returns: undefined
      }
      import_mobile_content_apply: {
        Args: { p_key: string; p_payload: Json; p_user_id: string }
        Returns: Json
      }
      import_snapshot_apply: {
        Args: {
          p_key: string
          p_payload: Json
          p_platform: string
          p_user_id: string
        }
        Returns: Json
      }
      lock_user_sync: { Args: { p_user_id: string }; Returns: undefined }
      next_sync_version: { Args: { p_user_id: string }; Returns: number }
      open_chest_apply: {
        Args: {
          p_chest_id: string
          p_item: Json
          p_key: string
          p_user_id: string
        }
        Returns: Json
      }
      pull_sync_batch: {
        Args: { p_after_version: number; p_max_versions: number }
        Returns: Json
      }
      reserve_idempotency_key: {
        Args: { p_key: string; p_operation: string; p_user_id: string }
        Returns: Json
      }
      resolve_battle_attempt_apply: {
        Args: {
          p_attempt_id: string
          p_key: string
          p_outcome: string
          p_user_id: string
          p_xp: number
        }
        Returns: Json
      }
      sell_item_apply: {
        Args: {
          p_item_id: string
          p_key: string
          p_user_id: string
          p_xp: number
        }
        Returns: Json
      }
      start_battle_attempt_apply: {
        Args: {
          p_attempt_id: string
          p_enemy: Json
          p_key: string
          p_player: Json
          p_stage: number
          p_user_id: string
        }
        Returns: Json
      }
      synthesize_items_apply: {
        Args: {
          p_ingredient_ids: string[]
          p_key: string
          p_result_item: Json
          p_user_id: string
        }
        Returns: Json
      }
      uncomplete_subtask: {
        Args: { p_id: string; p_key: string }
        Returns: Json
      }
      uncomplete_task: { Args: { p_id: string; p_key: string }; Returns: Json }
      upsert_profile: {
        Args: {
          p_active_title: string
          p_avatar: string
          p_base_version: number
          p_display_name: string
          p_key: string
        }
        Returns: Json
      }
      upsert_subtask: {
        Args: { p_id: string; p_key: string; p_name: string; p_task_id: string }
        Returns: Json
      }
      upsert_task: {
        Args: {
          p_due_date?: string
          p_id: string
          p_key: string
          p_name: string
          p_priority?: string
          p_recurrence?: string
          p_tags?: string[]
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
