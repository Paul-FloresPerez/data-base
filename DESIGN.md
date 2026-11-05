# Data-base design system

<!-- impeccable:design-schema 1 -->

## Direction

**Enterprise Operations / Premium Data Platform**. Un espacio claro de trabajo, no un panel SaaS decorativo: fondo mineral, superficies blancas precisas y jerarquía naval para decisiones operativas.

## Tokens

- Ink: `#101B2F`; brand: `#2457A7`; accent: `#174EA6`.
- Canvas: `#F5F7FA`; surface: `#FFFFFF`; line: `#E2E8F0`.
- Text: `#14243C`; muted: `#64748B`; danger: `#B42318`; success: `#157A4A`.
- Font: Inter/system sans; tabular figures for metrics and identifiers.
- Spacing scale: 4, 8, 12, 16, 24, 32, 40px. Radius 8px for controls, 12px for surfaces.
- Elevation uses restrained borders and a single soft shadow only for floating dialogs.

## Components

Headers separate operational context from primary action. Statuses use outlined badges. Tables stay dense with sticky visual hierarchy, responsive horizontal containment, and visible pagination. Buttons use one filled primary action per region.

## Motion

150–200ms opacity/color transforms only, disabled under `prefers-reduced-motion`. No decorative animation or gradient effects.

## Responsive

Desktop retains contextual sidebar; mobile uses the existing module selector. Content never creates page-level horizontal scrolling; tables scroll inside their own region.
