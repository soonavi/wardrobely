import React from "react";
import { Text } from "react-native";
import { Tabs } from "expo-router";
import { colors } from "../../src/lib/theme";

function TabIcon({ symbol, color }: { symbol: string; color: string }) {
  return <Text style={{ fontSize: 20, color }}>{symbol}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.faint,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
        },
      }}
    >
      <Tabs.Screen
        name="wardrobe"
        options={{
          title: "Wardrobe",
          tabBarIcon: ({ color }) => <TabIcon symbol="👕" color={color} />,
        }}
      />
      <Tabs.Screen
        name="tryon"
        options={{
          title: "Try On",
          tabBarIcon: ({ color }) => <TabIcon symbol="🪞" color={color} />,
        }}
      />
      <Tabs.Screen
        name="outfits"
        options={{
          title: "Outfits",
          tabBarIcon: ({ color }) => <TabIcon symbol="👜" color={color} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarIcon: ({ color }) => <TabIcon symbol="👤" color={color} />,
        }}
      />
    </Tabs>
  );
}
