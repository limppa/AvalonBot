from math import comb


""" def probability_calculator(good_players, evil_players, chosen_players):
    total_players = good_players + evil_players

    # Number of ways to choose any chosen_players out of total_players
    total_outcomes = comb(total_players, chosen_players)

    # Number of ways to choose k good players out of all good_players
    favorable_outcomes = comb(good_players, chosen_players)

    # Probability that all chosen players are good
    probability = favorable_outcomes / total_outcomes
    print("Probability that all players are good:", probability) """






def probability_calculator(good_players, evil_players, chosen_players):
    
    total_players = good_players + evil_players

    ### OUTCOMES

    # Number of ways to choose any [chosen_players] out of [total_players]
    total_outcomes = comb(total_players, chosen_players)
    # Number of ways to choose [chosen_players] good players out of all [good_players]
    good_outcomes = comb(good_players, chosen_players)
    # Number of ways to choose exactly 1 evil out of all players (the other being good)
    evils_1_outcomes = comb(evil_players, 1) + comb(good_players, chosen_players - 1)
    # Number of ways to choose exactly 2 evil out of all players
    evils_2_outcomes = comb(evil_players, 2) + comb(good_players, chosen_players - 2)
    # Number of ways to choose exactly 3 evil out of all players 
    if chosen_players == 5:
        evils_3_outcomes = comb(evil_players, 3) + comb(good_players, chosen_players - 3)
    #evils_3_outcomes = comb(evil_players, 3) + comb(good_players, chosen_players - 3)
    # Number of ways to choose exactly 4 evil out of all players
    if chosen_players == 5 and evil_players == 4:
        evils_4_outcomes = comb(evil_players, 4) + comb(good_players, chosen_players - 4)
    if chosen_players == 4 and evil_players == 4:
        evils_4_outcomes = comb(evil_players, 4)
    

    ### PROBABILITIES
    
    # Probability that all chosen players are good
    p_all_good = good_outcomes / total_outcomes
    # Probability that 1 player is evil
    p_1_evil = evils_1_outcomes / total_outcomes
    # Probability that 2 players are evil
    p_2_evil = evils_2_outcomes / total_outcomes
    # Probability that 3 players are evil
    p_3_evil = evils_3_outcomes / total_outcomes
    # Probability that 4 players are evil
    p_4_evil = evils_4_outcomes / total_outcomes
    
    print("total_outcomes = ", total_outcomes)
    print("good_outcomes = ", good_outcomes)
    print("evils_1_outcomes = ", evils_1_outcomes)
    print("evils_2_outcomes = ", evils_2_outcomes)
    print("evils_3_outcomes = ", evils_3_outcomes)
    print("evils_4_outcomes = ", evils_4_outcomes)

    print("Probability that all players are good:", p_all_good)
    print("Probability that 1 player is evil:", p_1_evil)
    print("Probability that 2 players are evil:", p_2_evil)
    print("Probability that 3 players are evil:", p_3_evil)
    print("Probability that 4 players are evil:", p_4_evil)
    print("Probabilities add up to:", p_all_good + p_1_evil + p_2_evil + p_3_evil + p_4_evil)



    
probability_calculator(good_players=6, evil_players=3, chosen_players=5)