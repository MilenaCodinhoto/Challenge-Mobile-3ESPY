import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { vehiclesApi } from '@/api/vehicles';
import { historyCache } from '@/storage/historyCache';
import {
  ATTRIBUTE_CATEGORIES,
  VEHICLE_PALETTE,
  findWinnerIndex,
  winnerStrategyFor,
} from '@/utils/compareHelpers';
import { titleCase } from '@/utils/format';
import { colors, radius, spacing, typography } from '@/theme/colors';
import type { CompareStackParamList } from '@/navigation/types';
import type { QueryResponse, SpecOut } from '@/types/api';

type Props = NativeStackScreenProps<CompareStackParamList, 'CompareResult'>;

interface ComparisonRow {
  attribute: string;
  cells: (SpecOut | null)[];
  winnerIdx: number | null;
}

interface Section {
  title: string;
  emoji: string;
  rows: ComparisonRow[];
}

interface Standing {
  query: QueryResponse;
  idx: number;
  wins: number;
}

export function CompareResultScreen({ route }: Props) {
  const { queryIds } = route.params;
  const [queries, setQueries] = useState<QueryResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        const loaded = await Promise.all(
          queryIds.map(async (id) => {
            const cached = await historyCache.loadQuery(id);
            if (cached) return cached;
            const fresh = await vehiclesApi.get(id);
            await historyCache.saveQuery(fresh);
            return fresh;
          }),
        );
        setQueries(loaded);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [queryIds]);

  const rows = useMemo<ComparisonRow[]>(() => {
    if (queries.length === 0) return [];
    const attributeSet = new Set<string>();
    for (const q of queries) {
      for (const s of q.specs) attributeSet.add(s.attribute);
    }
    return Array.from(attributeSet).map((attr) => {
      const cells = queries.map((q) => {
        const matches = q.specs.filter((s) => s.attribute === attr);
        if (matches.length === 0) return null;
        const available = matches.find((m) => m.available);
        return available ?? matches[0];
      });
      return {
        attribute: attr,
        cells,
        winnerIdx: findWinnerIndex(cells, attr),
      };
    });
  }, [queries]);

  const sections = useMemo<Section[]>(() => {
    const used = new Set<string>();
    const grouped: Section[] = ATTRIBUTE_CATEGORIES.map((cat) => {
      const sectionRows = rows.filter((r) => {
        if (cat.keys.includes(r.attribute)) {
          used.add(r.attribute);
          return true;
        }
        return false;
      });
      return { title: cat.title, emoji: cat.emoji, rows: sectionRows };
    }).filter((s) => s.rows.length > 0);
    const others = rows.filter((r) => !used.has(r.attribute));
    if (others.length > 0) {
      grouped.push({ title: 'Outros', emoji: '📋', rows: others });
    }
    return grouped;
  }, [rows]);

  // Placar: cada atributo numérico com vencedor vale 1 ponto pro veículo.
  const standings = useMemo<Standing[]>(() => {
    const wins = queries.map(() => 0);
    for (const row of rows) {
      if (row.winnerIdx !== null) wins[row.winnerIdx] += 1;
    }
    return queries
      .map((query, idx) => ({ query, idx, wins: wins[idx] }))
      .sort((a, b) => b.wins - a.wins);
  }, [rows, queries]);

  const decidedCount = useMemo(
    () => rows.filter((r) => r.winnerIdx !== null).length,
    [rows],
  );

  const topWins = standings[0]?.wins ?? 0;
  const leaders = standings.filter((s) => s.wins === topWins && topWins > 0);
  const champion = leaders.length === 1 ? leaders[0] : null;

  function toggleSection(title: string) {
    setCollapsed((prev) => ({ ...prev, [title]: !prev[title] }));
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.loadingBox}>
          <ActivityIndicator color={colors.fordBlue} />
          <Text style={styles.loadingText}>Carregando comparação…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || queries.length === 0) {
    return (
      <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
        <View style={styles.loadingBox}>
          <Text style={styles.error}>{error ?? 'Não foi possível carregar.'}</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['left', 'right', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        stickyHeaderIndices={[0]}
        showsVerticalScrollIndicator={false}
      >
        {/* Pills sticky com identidade visual de cada veículo */}
        <View style={styles.pillsBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillsContent}
          >
            {queries.map((q, idx) => {
              const palette = VEHICLE_PALETTE[idx];
              return (
                <View
                  key={q.id}
                  style={[styles.pill, { backgroundColor: palette.soft }]}
                >
                  <View style={[styles.pillDot, { backgroundColor: palette.primary }]} />
                  <View style={styles.pillContent}>
                    <Text style={styles.pillModel} numberOfLines={1}>
                      {q.model}
                    </Text>
                    <Text style={styles.pillVersion} numberOfLines={1}>
                      {q.brand} · {q.version}
                    </Text>
                  </View>
                </View>
              );
            })}
          </ScrollView>
        </View>

        {/* Placar da competição */}
        <View style={styles.standingsCard}>
          <Text style={styles.standingsEyebrow}>🏆 PLACAR DA COMPARAÇÃO</Text>
          <Text style={styles.standingsHeadline}>
            {decidedCount === 0
              ? 'Sem atributos numéricos para disputar'
              : champion
                ? `${champion.query.model} está na frente!`
                : 'Empate na liderança'}
          </Text>

          <View style={styles.standingsList}>
            {standings.map((s) => {
              const palette = VEHICLE_PALETTE[s.idx];
              const rank = standings.filter((o) => o.wins > s.wins).length;
              const isLeader = s.wins === topWins && topWins > 0;
              return (
                <View
                  key={s.query.id}
                  style={[styles.standingRow, isLeader && styles.standingRowLeader]}
                >
                  <Text style={styles.standingMedal}>{medalFor(rank)}</Text>
                  <View
                    style={[styles.standingDot, { backgroundColor: palette.primary }]}
                  />
                  <View style={styles.standingInfo}>
                    <Text style={styles.standingModel} numberOfLines={1}>
                      {s.query.model}
                    </Text>
                    <Text style={styles.standingVersion} numberOfLines={1}>
                      {s.query.version}
                    </Text>
                  </View>
                  <View style={styles.standingWinsBox}>
                    <Text
                      style={[
                        styles.standingWinsValue,
                        isLeader && styles.standingWinsValueLeader,
                      ]}
                    >
                      {s.wins}
                    </Text>
                    <Text style={styles.standingWinsLabel}>
                      {s.wins === 1 ? 'vitória' : 'vitórias'}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>

          {decidedCount > 0 ? (
            <Text style={styles.standingsFootnote}>
              Disputa decidida em {decidedCount} atributo(s) numérico(s) — potência,
              torque, 0-100, preço, autonomia, etc.
            </Text>
          ) : null}
        </View>

        {/* Seções colapsáveis */}
        {sections.map((section) => {
          const isCollapsed = collapsed[section.title];
          return (
            <View key={section.title} style={styles.section}>
              <Pressable
                onPress={() => toggleSection(section.title)}
                style={styles.sectionHeader}
              >
                <Text style={styles.sectionEmoji}>{section.emoji}</Text>
                <View style={styles.sectionTitleBlock}>
                  <Text style={styles.sectionTitle}>{section.title}</Text>
                  <Text style={styles.sectionMeta}>
                    {section.rows.length} atributo(s)
                  </Text>
                </View>
                <Text style={styles.sectionChevron}>{isCollapsed ? '▸' : '▾'}</Text>
              </Pressable>
              {!isCollapsed ? (
                <View style={styles.sectionBody}>
                  {section.rows.map((row) => (
                    <AttributeCard key={row.attribute} row={row} queries={queries} />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })}

        {/* Legenda */}
        <View style={styles.legend}>
          <Text style={styles.legendTitle}>Como ler</Text>
          <LegendItem
            symbol="🏆"
            text="Venceu o atributo (maior potência, menor 0-100, menor preço, etc)"
          />
          <LegendItem symbol="🤝" text="Empate — mesmo valor entre os veículos" />
          <LegendItem
            symbol="📊"
            text="Atributo de texto (motor, transmissão) — comparado, mas sem vencedor"
          />
          <LegendItem symbol="—" text="Não disponível neste veículo" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function medalFor(rank: number): string {
  if (rank === 0) return '🥇';
  if (rank === 1) return '🥈';
  if (rank === 2) return '🥉';
  return `${rank + 1}º`;
}

function LegendItem({ symbol, text }: { symbol: string; text: string }) {
  return (
    <View style={styles.legendItem}>
      <Text style={styles.legendSymbol}>{symbol}</Text>
      <Text style={styles.legendText}>{text}</Text>
    </View>
  );
}

function AttributeCard({
  row,
  queries,
}: {
  row: ComparisonRow;
  queries: QueryResponse[];
}) {
  const strategy = winnerStrategyFor(row.attribute);
  const strategyLabel =
    strategy === 'higher'
      ? 'maior é melhor'
      : strategy === 'lower'
        ? 'menor é melhor'
        : null;
  const isComparable = strategy !== 'none';
  const winnerModel = row.winnerIdx !== null ? queries[row.winnerIdx].model : null;

  return (
    <View style={[styles.card, winnerModel ? styles.cardHasWinner : null]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{titleCase(row.attribute)}</Text>
          {strategyLabel ? (
            <Text style={styles.cardStrategy}>{strategyLabel}</Text>
          ) : null}
        </View>
        {winnerModel ? (
          <View style={styles.winnerBadge}>
            <Text style={styles.winnerBadgeText} numberOfLines={1}>
              🏆 {winnerModel}
            </Text>
          </View>
        ) : isComparable ? (
          <View style={styles.tieBadge}>
            <Text style={styles.tieBadgeText}>🤝 Empate</Text>
          </View>
        ) : null}
      </View>

      <View style={styles.cardBody}>
        {row.cells.map((cell, idx) => {
          const palette = VEHICLE_PALETTE[idx];
          const isWinner = row.winnerIdx === idx;

          return (
            <View
              key={`${row.attribute}-${idx}`}
              style={[styles.vehicleRow, isWinner && styles.vehicleRowWinner]}
            >
              <View style={styles.vehicleRowHeader}>
                <View
                  style={[styles.vehicleDot, { backgroundColor: palette.primary }]}
                />
                <Text
                  style={[
                    styles.vehicleRowName,
                    isWinner && { color: palette.primary, fontWeight: '800' },
                  ]}
                  numberOfLines={1}
                >
                  {queries[idx].model}
                </Text>
                {isWinner ? <Text style={styles.winnerCrown}>🏆</Text> : null}
              </View>

              {cell?.available ? (
                <>
                  <View style={styles.valueLine}>
                    <Text
                      style={[
                        styles.valueText,
                        isWinner && { fontWeight: '800', color: colors.textPrimary },
                      ]}
                      numberOfLines={3}
                    >
                      {cell.value}
                    </Text>
                    {cell.normalized_unit ? (
                      <Text style={styles.unitText}>{cell.normalized_unit}</Text>
                    ) : null}
                  </View>

                  <Text style={styles.sourceText} numberOfLines={2}>
                    Fonte: {cell.source_hint ?? 'não informada'}
                  </Text>
                </>
              ) : (
                <View style={styles.missingLine}>
                  <Text style={styles.missingText}>— não disponível</Text>
                </View>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textSecondary, marginTop: spacing.md },
  error: {
    color: colors.danger,
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  scroll: { paddingBottom: spacing.xxl },

  // Pills bar (sticky)
  pillsBar: {
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingVertical: spacing.sm,
  },
  pillsContent: { paddingHorizontal: spacing.lg, gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    minWidth: 160,
    maxWidth: 220,
    marginRight: spacing.sm,
  },
  pillDot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.sm },
  pillContent: { flex: 1 },
  pillModel: { fontSize: 14, fontWeight: '800', color: colors.textPrimary },
  pillVersion: { fontSize: 11, color: colors.textSecondary, marginTop: 1 },

  // Standings (placar)
  standingsCard: {
    margin: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.fordBlue,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  standingsEyebrow: {
    color: '#A8C0EC',
    fontSize: 11,
    letterSpacing: 1.2,
    fontWeight: '800',
    marginBottom: spacing.xs,
  },
  standingsHeadline: {
    color: '#FFF',
    fontSize: 19,
    fontWeight: '800',
    marginBottom: spacing.md,
  },
  standingsList: { gap: spacing.sm },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.fordBlueDark,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  standingRowLeader: {
    backgroundColor: '#FEF3C7',
  },
  standingMedal: { fontSize: 20, width: 30, textAlign: 'center' },
  standingDot: { width: 10, height: 10, borderRadius: 5 },
  standingInfo: { flex: 1 },
  standingModel: { fontSize: 14, fontWeight: '800', color: colors.accent },
  standingVersion: { fontSize: 11, color: colors.textMuted, marginTop: 1 },
  standingWinsBox: { alignItems: 'center', minWidth: 56 },
  standingWinsValue: { fontSize: 22, fontWeight: '900', color: colors.surface },
  standingWinsValueLeader: { color: '#B45309' },
  standingWinsLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  standingsFootnote: {
    color: '#A8C0EC',
    fontSize: 11,
    marginTop: spacing.md,
    lineHeight: 16,
  },

  // Sections
  section: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.sm,
  },
  sectionEmoji: { fontSize: 22 },
  sectionTitleBlock: { flex: 1 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  sectionMeta: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  sectionChevron: { fontSize: 16, color: colors.textSecondary, paddingHorizontal: 4 },
  sectionBody: { padding: spacing.sm, paddingTop: 0 },

  // Attribute card
  card: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
  },
  cardHasWinner: { borderLeftColor: '#F59E0B', backgroundColor: '#FFFBEB' },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.textPrimary },
  cardStrategy: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: 1,
    fontStyle: 'italic',
  },
  winnerBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#FEF3C7',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: '#F59E0B',
    maxWidth: 150,
  },
  winnerBadgeText: { fontSize: 11, fontWeight: '800', color: '#B45309' },
  tieBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tieBadgeText: { fontSize: 11, fontWeight: '800', color: colors.textSecondary },
  cardBody: { gap: spacing.md },

  // Vehicle row inside card
  vehicleRow: {
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  vehicleRowWinner: {
    borderWidth: 1,
    borderColor: '#F59E0B',
  },
  vehicleRowHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 6,
  },
  vehicleDot: { width: 8, height: 8, borderRadius: 4 },
  vehicleRowName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  winnerCrown: { fontSize: 14 },
  valueLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: 4,
    marginBottom: 6,
  },
  valueText: {
    fontSize: 15,
    color: colors.textPrimary,
    fontWeight: '600',
    flexShrink: 1,
  },
  unitText: { fontSize: 11, color: colors.textMuted, fontWeight: '600' },
  sourceText: { fontSize: 11, color: colors.textMuted, fontStyle: 'italic' },

  missingLine: { paddingVertical: 4 },
  missingText: { color: colors.textMuted, fontStyle: 'italic', fontSize: 13 },

  // Legend
  legend: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  legendTitle: { ...typography.label, marginBottom: spacing.sm },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: spacing.sm,
  },
  legendSymbol: { fontSize: 14, width: 24 },
  legendText: { fontSize: 12, color: colors.textSecondary, flex: 1 },
});
