import React from 'react';
import PropTypes from 'prop-types';
import { FlexibleWidthXYPlot as XYPlot, XAxis, YAxis, LineSeries, AreaSeries, MarkSeries, Highlight, DiscreteColorLegend, Crosshair } from 'react-vis';
import 'react-vis/dist/style.css';

import { formatDuration, formatNumber } from 'common/format';
import SPELLS from 'common/SPELLS';
import SpellLink from 'common/SpellLink';
import Analyzer from 'parser/core/Analyzer';
import Panel from 'interface/others/Panel';
import VerticalLine from 'interface/others/charts/VerticalLine';

import './StaggerPoolGraph.scss';
import StaggerFabricator from '../core/StaggerFabricator';

const COLORS = {
  death: 'red',
  purify: '#00ff96',
  stagger: 'rgb(240, 234, 214)',
  hp: 'rgb(255, 139, 45)',
  maxHp: 'rgb(183, 76, 75)',
};

class StaggerGraph extends React.Component {
  static propTypes = {
    stagger: PropTypes.array.isRequired,
    hp: PropTypes.array.isRequired,
    maxHp: PropTypes.array.isRequired,
    purifies: PropTypes.array.isRequired,
    deaths: PropTypes.array.isRequired,
    startTime: PropTypes.number.isRequired,
  };

  state = {
    hover: null,
    xDomain: null,
    dragging: false,
  };

  render() {
    const {stagger, hp, maxHp, purifies, deaths, startTime} = this.props;
    const {xDomain} = this.state;
    return (
      <XYPlot height={400}
        className={'graph'}
        animation xDomain={xDomain && [xDomain.left, xDomain.right]}
        style={{
          fill: '#fff',
          stroke: '#fff',
        }}
        onMouseLeave={() => this.setState({ hover: null })}
        margin={{
          top: 30,
        }}
      >
        <DiscreteColorLegend
          orientation="horizontal"
          strokeWidth={2}
          items={[
            { title: 'Stagger', color: COLORS.stagger },
            { title: 'Purify', color: COLORS.purify },
            { title: 'Health', color: COLORS.hp },
            { title: 'Max Health', color: COLORS.maxHp },
            { title: 'Player Death', color: COLORS.death },
          ]}
          style={{
            position: 'absolute',
            top: '-15px',
            left: '30%',
          }}
        />
        <XAxis title="Time" tickFormat={value => formatDuration((value - startTime) / 1000)} />
        <YAxis title="Health" tickFormat={value => formatNumber(value)} />
        <AreaSeries
          data={hp}
          color={COLORS.hp}
          style={{strokeWidth: 2, fillOpacity: 0.2}}
        />
        <AreaSeries
          data={stagger}
          color={COLORS.stagger}
          style={{strokeWidth: 2, fillOpacity: 0.2}}
          onNearestX={d => this.setState({hover: d})}
          onSeriesMouseOut={() => this.setState({hover: null})}
        />
        <LineSeries
          data={maxHp}
          color={COLORS.maxHp}
          strokeWidth={2}
        />
        {deaths.map(({x}, idx) => (
          <VerticalLine
            key={`death-${idx}`}
            value={x}
            style={{
              line: { background: COLORS.death },
            }}
          />
        ))}
        {!this.state.dragging && this.state.hover && (
          <Crosshair
            className="tooltip-crosshair"
            values={[this.state.hover]}
            titleFormat={([ v ]) => ({ title: 'Stagger', value: formatNumber(v.y) })}
            itemsFormat={([ v ]) => {
              const entries = [
                { title: 'Health', value: `${formatNumber(v.hp)} / ${formatNumber(v.maxHp)}` },
              ];
              const purify = purifies.find(({x}) => Math.abs(x - v.x) < 500);
              if(purify) {
                entries.push({ title: 'Purified', value: formatNumber(purify.amount) });
              }
              return entries;
            }}
          />
        )}
        <Highlight
          enableY={false}
          onBrushStart={() => this.setState({dragging: true})}
          onBrushEnd={area => this.setState({xDomain: area, dragging: false})}
        />
        <MarkSeries
          data={purifies}
          color={COLORS.purify}
          onValueClick={d => this.setState({xDomain: { left: d.x - 10000, right: d.x + 10000 }})}
        />
      </XYPlot>
    );
  }
}

/**
 * A graph of staggered damage (and related quantities) over time.
 *
 * The idea of this is to help people identify the root cause of:
 *   - overly high dtps (purifying well after a peak instead of at the peak)
 *   - death (stagger ticking too high? one-shot? health trickling away without heals?)
 *
 * As well as just giving a generally interesting look into when damage
 * actually hit your health bar on a fight.
 */
class StaggerPoolGraph extends Analyzer {
  static dependencies = {
    fab: StaggerFabricator,
  };

  _hpEvents = [];
  _staggerEvents = [];
  _deathEvents = [];
  _purifyEvents = [];
  _lastHp = 0;
  _lastMaxHp = 0;

  on_addstagger(event) {
    this._staggerEvents.push({...event, hitPoints: this._lastHp, maxHitPoints: this._lastMaxHp });
  }

  on_removestagger(event) {
    if (event.trigger.ability && event.trigger.ability.guid === SPELLS.PURIFYING_BREW.id) {
      // record the *previous* timestamp for purification. this will
      // make the purifies line up with peaks in the plot, instead of
      // showing up *after* peaks
      this._purifyEvents.push({...event, previousTimestamp: this._staggerEvents[this._staggerEvents.length - 1].timestamp});
    }

    this._staggerEvents.push({...event, hitPoints: this._lastHp, maxHitPoints: this._lastMaxHp });
  }

  on_toPlayer_death(event) {
    this._deathEvents.push(event);
  }

  on_toPlayer_damage(event) {
    this._hpEvents.push(event);
    this._lastHp = event.hitPoints ? event.hitPoints : this._lastHp;
    this._lastMaxHp = event.maxHitPoints ? event.maxHitPoints : this._lastMaxHp;
  }

  on_toPlayer_heal(event) {
    this._hpEvents.push(event);
    this._lastHp = event.hitPoints ? event.hitPoints : this._lastHp;
    this._lastMaxHp = event.maxHitPoints ? event.maxHitPoints : this._lastMaxHp;
  }

  plot() {
    const stagger = this._staggerEvents.map(({timestamp, newPooledDamage, hitPoints, maxHitPoints}) => {
      return {
        x: timestamp,
        y: newPooledDamage,
        hp: hitPoints,
        maxHp: maxHitPoints,
      };
    });

    const purifies = this._purifyEvents.map(({previousTimestamp, newPooledDamage, amount}) => ({ x: previousTimestamp, y: newPooledDamage + amount, amount }));

    const hp = this._hpEvents.filter(({hitPoints}) => hitPoints !== undefined)
      .map(({timestamp, hitPoints}) => {
        return {
          x: timestamp,
          y: hitPoints,
        };
      });

    const maxHp = this._hpEvents.filter(({maxHitPoints}) => maxHitPoints !== undefined)
      .map(({timestamp, maxHitPoints}) => {
        return {
          x: timestamp,
          y: maxHitPoints,
        };
      });

    const deaths = this._deathEvents.map(({timestamp}) => ({x: timestamp}));
    return (
      <div className="graph-container">
        <StaggerGraph
          startTime={this.owner.fight.start_time}
          stagger={stagger}
          hp={hp}
          maxHp={maxHp}
          purifies={purifies}
          deaths={deaths} />
      </div>
    );
  }

  tab() {
    return {
      title: 'Stagger',
      url: 'stagger',
      render: () => (
        <Panel
          title="Stagger"
          explanation={(
            <>
              Damage you take is placed into a <em>pool</em> by <SpellLink id={SPELLS.STAGGER.id} />. This damage is then removed by the damage-over-time component of <SpellLink id={SPELLS.STAGGER.id} /> or by <SpellLink id={SPELLS.PURIFYING_BREW.id} /> (or other sources of purification). This plot shows the amount of damage pooled over the course of the fight.
            </>
          )}
        >
          {this.plot()}
        </Panel>
      ),
    };
  }
}

export default StaggerPoolGraph;
